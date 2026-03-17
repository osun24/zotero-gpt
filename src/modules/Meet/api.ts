import {
  getClipboardText,
  getItemField,
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
    /**
     * Return a field value from the selected item.
     * If multiple items are selected, only the first item is used.
     * @fieldName The Zotero field name, for example "abstractNote"
     */
    getItemField, 
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
  }
}

export default Meet
