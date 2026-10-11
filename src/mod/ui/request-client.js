"use strict";
class RequestClient {
  constructor(api, revision) {
    this.api = api;
    this.revision = revision;
    this.sequence = 0;
    this.active = new Map();
  }
  request({ direction, text, priority = "foreground" }) {
    if (this.active.size >= 64)
      return {
        requestId: null,
        promise: Promise.reject(
          Object.assign(new Error("翻译队列已满。"), {
            code: priority === "background" ? "BUSY_SKIPPED" : "BUSY",
          }),
        ),
      };
    const expectedExecutionRevision = this.revision();
    const requestId = `babel:${++this.sequence}`;
    let call;
    try {
      call = this.api.translate({
        requestId,
        expectedExecutionRevision,
        direction,
        text,
        priority,
      });
    } catch (error) {
      call = Promise.reject(error);
    }
    const promise = Promise.resolve(call)
      .then((result) => {
        if (result?.ok === false)
          throw Object.assign(
            new Error(result.error?.message || "翻译失败。"),
            { ...result.error },
          );
        return result;
      })
      .finally(() => this.active.delete(requestId));
    this.active.set(requestId, promise);
    return { requestId, promise };
  }
  cancel(ids = [...this.active.keys()]) {
    return this.api.cancel?.({ requestIds: ids }) || Promise.resolve();
  }
}
module.exports = { RequestClient };
