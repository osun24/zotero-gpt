import { config } from "../../package.json";

class LocalStorage {
  public filename = "";
  public cache: any = {};
  public lock: any;
  public writable = false;
  constructor(filename: string) {
    this.lock = Zotero.Promise.defer()
    this.init(filename).catch((error) => {
      this.debug("init:unhandledError", error)
      this.cache = {}
      this.writable = false
      this.lock.resolve()
    })
  }

  private debug(stage: string, error?: any) {
    const prefix = `[${config.addonRef}][localStorage] ${stage}`
    const message = error?.message ? `${prefix} ${error.message}` : prefix
    try {
      Zotero.debug(message)
    } catch {}
    try {
      const consoleObject =
        (typeof window != "undefined" && (window as any).console) ||
        (typeof Zotero != "undefined" && (Zotero.getMainWindow?.() as any)?.console)
      consoleObject?.log?.(prefix, error || "")
    } catch {}
  }

  async init(filename: string) {
    try {
      const temp = Zotero.getTempDirectory() as any
      const file = temp?.clone ? temp.clone() : temp
      if (file?.append) {
        file.append(`${filename}.json`)
        this.filename = file.path || ""
        this.writable = !!this.filename
      }
      if (this.filename) {
        const rawString = await Zotero.File.getContentsAsync(this.filename) as string
        this.cache = rawString ? JSON.parse(rawString) : {}
      } else {
        this.debug("init:noFilename")
        this.cache = {}
      }
    } catch (error) {
      this.debug("init:fallbackToMemory", error)
      this.cache = {}
      this.writable = !!this.filename
    } finally {
      this.lock.resolve()
    }
  }

  get(item: Zotero.Item | { key: string }, key: string) {
    if (this.cache == undefined) { return }
    return (this.cache[item.key] ??= {})[key]
  }

  async set(item: Zotero.Item | { key: string }, key: string, value: any) {
    await this.lock.promise;
    (this.cache[item.key] ??= {})[key] = value
    if (!this.writable || !this.filename) {
      return
    }
    window.setTimeout(async () => {
      try {
        await Zotero.File.putContentsAsync(this.filename, JSON.stringify(this.cache));
      } catch (error) {
        this.debug("set:writeFailed", error)
      }
    })
  }
}

export default LocalStorage
