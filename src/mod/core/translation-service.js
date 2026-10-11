"use strict";
const { createHash } = require("node:crypto");
const { failure, publicFailure } = require("./errors");
const { validateEndpoint } = require("../../shared/settings");
const { buildProviderRequest } = require("./provider-fetch");
const {
  buildTranslationMessages,
  resolveModelConfig,
} = require("../../shared/translate");
class TranslationService {
  constructor({ snapshot, credential, provider, cache }) {
    Object.assign(this, { snapshot, credential, provider, cache });
    this.jobs = new Map();
    this.consumers = new Map();
    this.admissions = new Map();
    this.foreground = [];
    this.background = [];
    this.active = 0;
    this.backgroundActive = 0;
    this.pause = null;
    this.sequence = 0;
  }
  async translate(owner, request) {
    let admissionKey, admission;
    try {
      if (
        !request ||
        !/^[\w:-]{1,80}$/.test(request.requestId) ||
        !["read", "send"].includes(request.direction) ||
        !["foreground", "background"].includes(request.priority) ||
        typeof request.text !== "string" ||
        !request.text.trim() ||
        request.text.length > 12000
      )
        throw failure("INPUT", null, { reason: typeof request?.text === "string" && request.text.length > 12000 ? "TEXT_LIMIT" : "EMPTY_TEXT", params: { limit: 12000 } });
      admissionKey = `${owner}:${request.requestId}`;
      if (
        this.consumers.has(admissionKey) ||
        this.admissions.has(admissionKey) ||
        [...this.consumers.values(), ...this.admissions.values()].filter(
          (c) => c.owner === owner,
        ).length >= 64
      )
        throw failure("BUSY");
      admission = { owner, requestId: request.requestId, canceled: false };
      this.admissions.set(admissionKey, admission);
      const snapshot = this.snapshot();
      if (request.expectedExecutionRevision !== snapshot.executionRevision)
        throw failure("STALE_REVISION");
      if (
        !snapshot.settings.enabled ||
        (request.direction === "send" &&
          !snapshot.settings.sendTranslation.enabled)
      )
        throw failure("DISABLED");
      validateEndpoint(snapshot.settings.model);
      if (this.pause && this.pause.revision !== snapshot.executionRevision)
        this.pause = null;
      if (
        request.priority === "background" &&
        this.pause &&
        (this.pause.until === Infinity || this.pause.until > Date.now())
      )
        throw failure("PAUSED");
      const credential = this.credential(snapshot.settings.model);
      const generation = this.cache.generation;
      await this.cache.ready;
      if (admission.canceled) throw failure("CANCELED");
      if (this.snapshot().executionRevision !== snapshot.executionRevision)
        throw failure("STALE_REVISION");
      const consumerKey = `${owner}:${request.requestId}`;
      this.admissions.delete(admissionKey);
      const model = resolveModelConfig(snapshot.settings.model);
      const messages = buildTranslationMessages({
        text: request.text,
        direction: request.direction,
        settings: snapshot.settings,
      });
      const effectiveRequest = buildProviderRequest(model, messages, "");
      const cacheKey = createHash("sha256")
        .update(
          JSON.stringify({
            namespace: credential.namespace,
            protocol: effectiveRequest.protocol,
            url: effectiveRequest.url,
            body: effectiveRequest.body,
          }),
        )
        .digest("hex");
      const cached =
        request.direction === "read" && generation === this.cache.generation
          ? this.cache.get(cacheKey)
          : undefined;
      if (cached !== undefined)
        return {
          ok: true,
          text: cached,
          cacheHit: true,
          executionRevision: snapshot.executionRevision,
        };
      const jobKey =
        request.direction === "read"
          ? `${snapshot.executionRevision}:${generation}:${cacheKey}`
          : `send:${++this.sequence}`;
      let job = this.jobs.get(jobKey);
      if (!job) {
        const queue =
          request.priority === "background" ? this.background : this.foreground;
        if (queue.length >= 16) {
          if (request.priority === "foreground") throw failure("BUSY");
          this.finish(queue.shift(), publicFailure(failure("BUSY_SKIPPED")));
        }
        job = {
          jobKey,
          cacheKey,
          generation,
          revision: snapshot.executionRevision,
          settings: snapshot.settings,
          apiKey: credential.apiKey,
          direction: request.direction,
          text: request.text,
          priority: request.priority,
          controller: new AbortController(),
          consumers: new Set(),
          started: false,
        };
        this.jobs.set(jobKey, job);
        queue.push(job);
      } else if (
        !job.started &&
        request.priority === "foreground" &&
        job.priority === "background"
      ) {
        if (this.foreground.length >= 16) throw failure("BUSY");
        this.background.splice(this.background.indexOf(job), 1);
        job.priority = "foreground";
        this.foreground.push(job);
      }
      return await new Promise((resolve) => {
        const consumer = { owner, requestId: request.requestId, resolve, job };
        this.consumers.set(consumerKey, consumer);
        job.consumers.add(consumerKey);
        this.pump();
      });
    } catch (error) {
      return publicFailure(error);
    } finally {
      if (admissionKey && this.admissions.get(admissionKey) === admission)
        this.admissions.delete(admissionKey);
    }
  }
  cancel(owner, requestIds) {
    for (const requestId of requestIds) {
      const key = `${owner}:${requestId}`;
      const admitted = this.admissions.get(key);
      if (admitted) admitted.canceled = true;
      const consumer = this.consumers.get(key);
      if (!consumer) continue;
      this.consumers.delete(key);
      consumer.job.consumers.delete(key);
      consumer.resolve(publicFailure(failure("CANCELED")));
      if (!consumer.job.consumers.size) {
        consumer.job.controller.abort();
        this.removeQueued(consumer.job);
        this.jobs.delete(consumer.job.jobKey);
      }
    }
    return { ok: true };
  }
  removeQueued(job) {
    for (const queue of [this.foreground, this.background]) {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
    }
  }
  finish(job, result) {
    if (!job) return;
    for (const key of job.consumers) {
      const consumer = this.consumers.get(key);
      if (consumer) {
        this.consumers.delete(key);
        consumer.resolve(result);
      }
    }
    job.consumers.clear();
    if (this.jobs.get(job.jobKey) === job) this.jobs.delete(job.jobKey);
    this.removeQueued(job);
  }
  invalidate(revision) {
    for (const job of [...this.jobs.values()])
      if (job.revision !== revision) {
        job.controller.abort();
        this.finish(job, publicFailure(failure("STALE_REVISION")));
      }
    if (this.pause?.revision !== revision) this.pause = null;
    this.pump();
  }
  pump() {
    while (this.active < 4) {
      const job =
        this.foreground.shift() ||
        (this.backgroundActive < 2 && !this.pauseActive()
          ? this.background.shift()
          : null);
      if (!job) break;
      if (job.revision !== this.snapshot().executionRevision) {
        this.finish(job, publicFailure(failure("STALE_REVISION")));
        continue;
      }
      job.started = true;
      this.active++;
      if (job.priority === "background") this.backgroundActive++;
      Promise.resolve()
        .then(() => {
          if (job.controller.signal.aborted || !job.consumers.size)
            throw failure("CANCELED");
          return this.provider.translate({
            settings: job.settings,
            apiKey: job.apiKey,
            direction: job.direction,
            text: job.text,
            signal: job.controller.signal,
          });
        })
        .then((text) => {
          if (
            job.priority === "foreground" &&
            job.consumers.size &&
            this.pause &&
            this.pause.reason === "QUOTA" &&
            this.pause.revision === job.revision &&
            job.revision === this.snapshot().executionRevision
          )
            this.pause = null;
          if (job.consumers.size && job.direction === "read")
            this.cache.put(job.cacheKey, text, job.generation);
          this.finish(job, { ok: true, text, executionRevision: job.revision });
        })
        .catch((error) => {
          const current =
            !job.controller.signal.aborted &&
            job.consumers.size > 0 &&
            job.revision === this.snapshot().executionRevision;
          if (
            current &&
            job.priority === "background" &&
            [
              "AUTH",
              "NO_KEY",
              "KEY_UNAVAILABLE",
              "CONFIG",
              "INSECURE_HTTP",
              "RATE_LIMIT",
            ].includes(error.code)
          ) {
            this.pause = {
              revision: job.revision,
              code: error.code,
              reason: error.reason || "",
              until:
                error.code === "RATE_LIMIT" && error.reason !== "QUOTA"
                  ? Date.now() + Math.min(300, Number(error.retryAfter) || 30) * 1000
                  : Infinity,
            };
            for (const queued of [...this.background])
              this.finish(queued, publicFailure(failure("PAUSED")));
          }
          this.finish(job, publicFailure(error));
        })
        .finally(() => {
          this.active--;
          if (job.priority === "background") this.backgroundActive--;
          job.apiKey = "";
          this.pump();
        });
    }
  }
  pauseActive() {
    return (
      this.pause &&
      this.pause.revision === this.snapshot().executionRevision &&
      this.pause.until > Date.now()
    );
  }
  status() {
    return {
      active: this.active,
      backgroundActive: this.backgroundActive,
      foregroundQueued: this.foreground.length,
      backgroundQueued: this.background.length,
      paused: this.pauseActive()
        ? {
            code: this.pause.code,
            until: this.pause.until === Infinity ? null : this.pause.until,
          }
        : null,
    };
  }
}
module.exports = { TranslationService };
