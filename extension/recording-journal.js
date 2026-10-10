// Each chunk is committed separately, so a lost offscreen process does not
// discard an entire recording's open writable stream.
class RecordingJournal {
  constructor(root) { this.root = root; this.directory = null; this.meta = null; }
  async read() {
    try { this.directory = await this.root.getDirectoryHandle('recording-parts'); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
    this.meta = JSON.parse(await (await this.directory.getFileHandle('metadata.json')).getFile().then(file => file.text()));
    if (this.meta.version !== 1 || !Number.isSafeInteger(this.meta.count) || this.meta.count < 0 || this.meta.count > 1000000 || !Number.isFinite(this.meta.bytes) || this.meta.bytes < 0 || typeof this.meta.filename !== 'string') throw new Error('錄影暫存索引無法讀取；請保留資料並匯出錯誤紀錄。');
    return this.meta;
  }
  async saveMeta() {
    const writable = await (await this.directory.getFileHandle('metadata.json',{create:true})).createWritable();
    try { await writable.write(JSON.stringify(this.meta)); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
  }
  async begin(meta) {
    await this.remove();
    this.directory = await this.root.getDirectoryHandle('recording-parts',{create:true});
    this.meta = {...meta,version:1,count:0,bytes:0,complete:false};
    await this.saveMeta();
  }
  async append(blob) {
    const handle = await this.directory.getFileHandle(`part-${this.meta.count}`,{create:true});
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => {}); throw error; }
    this.meta.count++; this.meta.bytes += blob.size;
    await this.saveMeta();
  }
  async assemble(writable) {
    for (let i=0;i<this.meta.count;i++) {
      const file = await (await this.directory.getFileHandle(`part-${i}`)).getFile();
      await writable.write(file);
    }
  }
  async remove() {
    try { await this.root.removeEntry('recording-parts',{recursive:true}); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    this.directory = null; this.meta = null;
  }
}
