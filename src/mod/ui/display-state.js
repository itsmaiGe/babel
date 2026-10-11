"use strict";
class DisplayState {
  constructor() {
    this.records = new Map();
    this.maxEntries = 500;
    this.maxBytes = 4 * 1024 * 1024;
  }
  get(id) {
    const record = this.records.get(id);
    if (record) {
      this.records.delete(id);
      this.records.set(id, record);
    }
    return record;
  }
  set(id, record) {
    this.records.delete(id);
    this.records.set(id, record);
    this.trim();
    return record;
  }
  bytes() {
    let bytes = 0;
    for (const record of this.records.values())
      for (const unit of record.units.values())
        bytes += new TextEncoder().encode(
          (unit.source || "") + (unit.text || ""),
        ).length;
    return bytes;
  }
  trim() {
    while (
      this.records.size > this.maxEntries ||
      this.bytes() > this.maxBytes
    ) {
      const oldest = [...this.records].find(
        ([, record]) => !record.active.size,
      );
      if (!oldest) break;
      this.records.delete(oldest[0]);
    }
  }
}
module.exports = { DisplayState };
