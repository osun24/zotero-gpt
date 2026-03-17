import { config } from "../../../package.json";
import {
  getClipboardText,
  getCurrentPDFItem,
  getFullPDFText,
  getItemField,
  hasOpenPDF,
  getPDFSelection,
  getRelatedText,
  getPDFAnnotations
} from "./Zotero"

import {
  getGPTResponse
} from "./OpenAI"
import Views from "../views";

const Meet: {
  [key: string]: any;
  Global: {
    [key: string]: any;
    views: Views | undefined
  }
} = {
  /**
   * Public APIs exposed to tag templates.
   * Example: Meet.Zotero.xxx()
   */
  Zotero: {
    /** Return text from the system clipboard. */
    getClipboardText,
    /** Return the currently open PDF item, if any. */
    getCurrentPDFItem,
    /** Return normalized text extracted from the currently open PDF. */
    getFullPDFText,
    /**
     * Return a field value from the selected item.
     * If multiple items are selected, only the first item is used.
     * @fieldName The Zotero field name, for example "abstractNote"
     */
    getItemField, 
    /** Return whether the current tab is an open PDF reader. */
    hasOpenPDF,
    /** Return the current text selection in the PDF reader. */
    getPDFSelection,
    /**
     * Return related passages.
     * In the library, this finds related selected items.
     * In the PDF reader, this returns the most relevant PDF passages.
     * @queryText The query string used for matching
     */
    getRelatedText,
    /**
     * Return PDF annotations.
     * @select Whether to return only selected annotations
     * getPDFAnnotations(true) returns selected annotations only
     * getPDFAnnotations() returns all annotations
     */
    getPDFAnnotations,
  },
  OpenAI: {
    getGPTResponse
  },
  Global: {
    lock: undefined,
    input: undefined,
    views: undefined,
    popupWin: undefined,
    storage: undefined
  },
  debug(...args: any[]) {
    const prefix = `[${config.addonRef}]`
    const messageParts = [prefix, ...args].map((value) => {
      if (typeof value == "string") {
        return value
      }
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    })
    const message = messageParts.join(" ")
    try {
      const consoleObject =
        (typeof window != "undefined" && (window as any).console) ||
        (typeof Zotero != "undefined" && (Zotero.getMainWindow?.() as any)?.console) ||
        (typeof globalThis != "undefined" && (globalThis as any).console)
      consoleObject?.log?.(prefix, ...args)
    } catch {}
    try {
      Zotero.debug(message)
    } catch {}
  },
  progress(options: { text: string; type?: string; progress?: number; idx?: number }) {
    const popupWin = Meet.Global.popupWin
    if (!popupWin?.createLine) {
      Meet.debug("progress:skip", {
        hasPopupWin: !!popupWin,
        hasCreateLine: !!popupWin?.createLine,
        text: options.text
      })
      return undefined
    }
    try {
      Meet.debug("progress:createLine", {
        text: options.text,
        type: options.type,
        progress: options.progress
      })
      return popupWin.createLine(options)
    } catch (error: any) {
      Meet.debug("progress:createLine:error", {
        text: options.text,
        message: error?.message,
        stack: error?.stack
      })
      return undefined
    }
  }
}

export default Meet
