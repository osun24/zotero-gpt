import { config } from "../../package.json";
import Meet from "./Meet/api"
import Utils from "./utils";
import { Document } from "langchain/document";
import { help, fontFamily, defaultTags, parseTag, retiredDefaultTagNames, renamedDefaultTagNames } from "./base"
const markdown = require("markdown-it")({
  breaks: true, // Convert line breaks into <br> tags
  xhtmlOut: true, // Use /> closing style instead of >
  typographer: true,
  html: false,
});
const mathjax3 = require('markdown-it-mathjax3');
markdown.use(mathjax3);

export default class Views {
  private id = "zotero-GPT-container";
  /** Chat history passed to the GPT response functions. */
  public messages: { role: "user" | "assistant"; content: string }[] = [];
  /** Store prior inputs so Up/Down can navigate history. */
  private _history: { input: string; output: string }[] = []
  /** Store the last executed tag so Ctrl+Enter can rerun it. */
  private _tag: Tag | undefined;
  /** Track active streaming intervals so they can be stopped safely. */
  public _ids: {type: "follow"| "output", id: number}[] = []
  public container!: HTMLDivElement;
  private inputContainer!: HTMLDivElement;
  private outputContainer!: HTMLDivElement;
  private emptyState!: HTMLDivElement;
  private statusPill!: HTMLDivElement;
  private dotsContainer!: HTMLElement;
  private tagsContainer!: HTMLDivElement;
  private resizeHandle!: HTMLDivElement;
  private utils: Utils;
  constructor() {
    this.utils = new Utils()
    this.registerKey()
    this.addStyle()
    // @ts-ignore
    window.Meet = Meet
    Meet.Global.views = this
  }

  private addStyle() {
    ztoolkit.UI.appendElement({
      tag: "style",
      id: `${config.addonRef}-style`,
      namespace: "html",
      properties: {
        innerHTML: `
          @keyframes loading {
            0%, 100%
            {
              opacity: 0.25;
            }
            50%
            {
              opacity: 0.8;
            }
          }
          #${this.id} .three-dots:hover {
            opacity: 0.8 !important;
          }
          #${this.id} .three-dots.loading .dot:nth-child(1) {
            animation-delay: 0s;
          }
          #${this.id} .three-dots.loading .dot:nth-child(2) {
            animation-delay: 0.5s;
          }
          #${this.id} .three-dots.loading .dot:nth-child(3) {
            animation-delay: 1s;
          }
          #${this.id} .three-dots.loading .dot {
            animation: loading 1.5s ease-in-out infinite;
          }
          #${this.id} ::-moz-selection {
            background: rgba(89, 192, 188, .8); 
            color: #fff;
          }
          #output-container * {
            font-family: ${fontFamily} !important;
          }
          #output-container, #output-container * {
            user-select: text;
            -moz-user-select: text;
          }
          #output-container div p, #output-container div span {
            marigin: 0;
            padding: 0;
            text-align: justify;
          }
          .gpt-menu-box .menu-item:hover, .gpt-menu-box .menu-item.selected{
            background-color: rgba(89, 192, 188, .23) !important;
          }
          #${this.id} .tag {
            position: relative;
            overflow: hidden;
          }
          #${this.id} .ripple {
            left: 0;
            top: 50%;
            position: absolute;
            background: #fff;
            transform: translate(-50%, -50%);
            pointer-events: none;
            border-radius: 50%;
            animation: ripple 1.5s linear;
          }
          @keyframes ripple {
            from {
              width: 0px;
              height: 0px;
              opacity: 0.5;
            }
            to {
              width: 500px;
              height: 500px;
              opacity: 0;
            }
          }
          #${this.id} .resize-handle {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 18px;
            height: 18px;
            cursor: nwse-resize;
            opacity: 0.45;
            transition: opacity .2s linear;
          }
          #${this.id} .resize-handle:hover {
            opacity: 0.8;
          }
          #${this.id} .resize-handle:before,
          #${this.id} .resize-handle:after {
            content: "";
            position: absolute;
            right: 4px;
            bottom: 4px;
            width: 9px;
            height: 1.5px;
            background: rgba(55, 65, 81, 0.5);
            transform-origin: right center;
            transform: rotate(-45deg);
          }
          #${this.id} .resize-handle:before {
            right: 7px;
            bottom: 7px;
          }
        `
      },
      // #output-container div.streaming span:after,  
    }, document.documentElement);

    ztoolkit.UI.appendElement({
      tag: "link",
      id: `${config.addonRef}-link`,
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/md.css`
      }
    }, document.documentElement)
  }

  /** Set the text shown in the GPT output area. */
  public setText(text: string, isDone: boolean = false, scrollToNewLine: boolean = true, isRecord: boolean = true,) {
    this.setOutputState("content")
    this.outputContainer.style.display = ""
    const outputDiv = this.outputContainer.querySelector(".markdown-body")! as HTMLDivElement
    outputDiv.setAttribute("pureText", text);
    outputDiv.classList.add("streaming");
    let ready = () => {
      if (outputDiv.innerHTML.trim() == "") {
        outputDiv.innerHTML = `<p></p>`
      }
    }
    ready()
    /** Diff-based rendering preserves the cursor blink state. */
    let md2html = () => {
      let result = markdown.render(text)
        // .replace(/<mjx-assistive-mml[^>]*>.*?<\/mjx-assistive-mml>/g, "")
      /** Compare nodes and replace changed nodes or text only. */
      let diffRender = (oldNode: any, newNode: any) => {
        if (newNode.nodeName == "svg") {
          oldNode.parentNode.replaceChild(newNode, oldNode)
          return
        }
        if (oldNode.nodeName == "#text" && newNode.nodeName == "#text") { 
          oldNode.data = newNode.data
          return
        } else {
          if (
            oldNode.outerHTML == newNode.outerHTML &&
            oldNode.innerHTML == newNode.innerHTML
          ) {
            return
          }
        }
        // Remove extra old nodes if the new tree is shorter
        [...oldNode.childNodes].slice(newNode.childNodes.length).forEach((e: any)=>e.remove())
        for (let i = 0; i < newNode.childNodes.length; i++) {
          if (i < oldNode.childNodes.length) {
            if (oldNode.childNodes[i].tagName != newNode.childNodes[i].tagName) {
              if (oldNode.childNodes[i].tagName == "#text") {
                oldNode.childNodes[i].remove()
                oldNode.appendChild(newNode.childNodes[i])
              } else {
                oldNode.replaceChild(newNode.childNodes[i], oldNode.childNodes[i])
              }
              continue
            } else {
              diffRender(oldNode.childNodes[i], newNode.childNodes[i])
            }
          } else {
            oldNode.appendChild(newNode.childNodes[i])
          }
        }
      }
      // Plain text does not need markdown rendering first
      let _outputDiv = outputDiv.cloneNode(true) as HTMLDivElement
      try {
        _outputDiv.innerHTML = result
        if (outputDiv.childNodes.length == 0) {
          outputDiv.innerHTML = result
        } else {
          diffRender(outputDiv, _outputDiv)
        }
      } catch {
        outputDiv.innerText = result
      }
    }
    md2html()
    ready()
    // @ts-ignore
    scrollToNewLine && this.outputContainer.scrollBy(0, this.outputContainer.scrollTopMax)
    if (isDone) {
      // Final render should replace any transient streaming artifacts
      outputDiv.innerHTML = markdown.render(text)
      if (isRecord) {
        this._history.push({ input: Meet.Global.input, output: text })
      }
      outputDiv.classList.remove("streaming")
    }
  }

  private showError(title: string, message: string) {
    Meet.debug("views:showError", { title, message })
    this.setStatus("error", title)
    this.setText(`## ${title}\n\n${message}`, true, false)
    new ztoolkit.ProgressWindow(title, { closeOtherProgressWindows: true })
      .createLine({ text: message, type: "default" })
      .show()
  }

  private logDebug(stage: string, details?: any) {
    Meet.debug(`views:${stage}`, details ?? "")
  }

  private safePopupLine(popupWin: any, stage: string, options: { text: string; type?: string; progress?: number; idx?: number }) {
    if (!popupWin?.createLine) {
      this.logDebug(`${stage}:skip`, {
        hasPopupWin: !!popupWin,
        hasCreateLine: !!popupWin?.createLine,
        text: options.text
      })
      return
    }
    try {
      this.logDebug(`${stage}:createLine`, {
        text: options.text,
        type: options.type,
        progress: options.progress
      })
      popupWin.createLine(options)
    } catch (error: any) {
      this.logDebug(`${stage}:createLine:error`, {
        text: options.text,
        message: error?.message,
        stack: error?.stack
      })
    }
  }

  private safeStartCloseTimer(popupWin: any, stage: string, delay: number) {
    if (!popupWin?.startCloseTimer) {
      this.logDebug(`${stage}:startCloseTimer:skip`, {
        hasPopupWin: !!popupWin,
        hasStartCloseTimer: !!popupWin?.startCloseTimer,
        delay
      })
      return
    }
    try {
      this.logDebug(`${stage}:startCloseTimer`, { delay })
      popupWin.startCloseTimer(delay)
    } catch (error: any) {
      this.logDebug(`${stage}:startCloseTimer:error`, {
        delay,
        message: error?.message,
        stack: error?.stack
      })
    }
  }

  private getSelectedOutputText() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      return ""
    }
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (!anchorNode || !focusNode) {
      return ""
    }
    if (!this.outputContainer?.contains(anchorNode) && !this.outputContainer?.contains(focusNode)) {
      return ""
    }
    return selection.toString()
  }

  private copyTextToClipboard(text: string) {
    if (!text.length) {
      return false
    }
    try {
      new ztoolkit.Clipboard()
        .addText(text, "text/unicode")
        .copy()
      this.logDebug("copyTextToClipboard:success", { textLength: text.length })
      return true
    } catch (error: any) {
      this.logDebug("copyTextToClipboard:error", {
        message: error?.message,
        stack: error?.stack
      })
      return false
    }
  }

  private clampToViewport(x: number, y: number) {
    const maxX = Math.max(0, window.innerWidth - this.container.offsetWidth)
    const maxY = Math.max(0, window.innerHeight - this.container.offsetHeight)
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    }
  }

  private parseRGBColor(color: string) {
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
    if (rgbMatch) {
      return rgbMatch.slice(1, 4).map(Number)
    }
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hexMatch) {
      const hex = hexMatch[1]
      const parts = hex.length == 3
        ? hex.split("").map((part) => parseInt(part + part, 16))
        : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => parseInt(part, 16))
      return parts
    }
    return null
  }

  private getThemeMode() {
    const nodes = [document.body, document.documentElement, this.container].filter(Boolean) as HTMLElement[]
    for (const node of nodes) {
      const backgroundColor = window.getComputedStyle(node).backgroundColor
      if (!backgroundColor || backgroundColor == "transparent" || backgroundColor == "rgba(0, 0, 0, 0)") {
        continue
      }
      const rgb = this.parseRGBColor(backgroundColor)
      if (!rgb) {
        continue
      }
      const [r, g, b] = rgb
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return luminance < 140 ? "dark" : "light"
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"
  }

  private syncThemeMode() {
    const theme = this.getThemeMode()
    this.container?.setAttribute("data-theme", theme)
  }

  private getTagTrayCollapsed() {
    const value = Zotero.Prefs.get(`${config.addonRef}.tagTrayCollapsed`) as string | boolean
    return value === true || value === "true"
  }

  private setTagTrayCollapsed(collapsed: boolean) {
    Zotero.Prefs.set(`${config.addonRef}.tagTrayCollapsed`, collapsed ? "true" : "false")
    this.syncTagTrayCollapsed()
  }

  private syncTagTrayCollapsed() {
    const collapsed = this.getTagTrayCollapsed()
    this.container?.setAttribute("data-tag-tray-collapsed", collapsed ? "true" : "false")
    if (this.tagsContainer) {
      this.tagsContainer.style.display = collapsed ? "none" : "flex"
    }
    if (this.dotsContainer) {
      this.dotsContainer.textContent = collapsed ? "Show Tags" : "Hide Tags"
      this.dotsContainer.setAttribute("aria-expanded", collapsed ? "false" : "true")
    }
    if (!collapsed) {
      this.syncTagTrayAlignment()
    }
  }

  private syncTagTrayAlignment() {
    if (!this.tagsContainer) {
      return
    }
    window.setTimeout(() => {
      const shouldCenter = this.tagsContainer.scrollWidth <= this.tagsContainer.clientWidth + 4
      this.tagsContainer.style.justifyContent = shouldCenter ? "center" : "flex-start"
    }, 0)
  }

  private setStatus(state: "idle" | "loading" | "success" | "error", label?: string) {
    if (!this.container || !this.statusPill) {
      return
    }
    const defaultLabels = {
      idle: "Ready",
      loading: "Working",
      success: "Ready",
      error: "Needs Attention",
    }
    const text = label || defaultLabels[state]
    this.container.setAttribute("data-status", state)
    this.statusPill.setAttribute("data-state", state)
    this.statusPill.replaceChildren()
    if (state == "loading") {
      const spinner = document.createElement("span")
      spinner.className = "gpt-status-spinner"
      this.statusPill.append(spinner)
    } else {
      const indicator = document.createElement("span")
      indicator.className = "gpt-status-dot"
      this.statusPill.append(indicator)
    }
    const textNode = document.createElement("span")
    textNode.className = "gpt-status-text"
    textNode.textContent = text
    this.statusPill.append(textNode)
  }

  private setOutputState(
    state: "empty" | "loading" | "content",
    options: { title?: string; message?: string } = {}
  ) {
    if (!this.outputContainer || !this.emptyState) {
      return
    }
    this.outputContainer.setAttribute("data-view", state)
    if (state == "content") {
      this.emptyState.style.display = "none"
      const markdownBody = this.outputContainer.querySelector(".markdown-body") as HTMLDivElement
      markdownBody.style.display = ""
      return
    }
    const title = options.title || (state == "loading" ? "Generating response" : "Ask ZoteroGPT")
    const message = options.message || (
      state == "loading"
        ? "Preparing context and waiting for the model."
        : "Ask about a selected item, open PDF, or saved tag."
    )
    this.outputContainer.style.display = ""
    this.emptyState.style.display = ""
    this.emptyState.setAttribute("data-state", state)
    this.emptyState.innerHTML = `
      <div class="gpt-empty-eyebrow">${state == "loading" ? "Working" : "Ready"}</div>
      <div class="gpt-empty-title">${title}</div>
      <div class="gpt-empty-copy">${message}</div>
    `
    const markdownBody = this.outputContainer.querySelector(".markdown-body") as HTMLDivElement
    markdownBody.style.display = "none"
  }

  private closeWindow() {
    this.hide()
    this.container?.remove()
  }

  private getStoredContainerSize() {
    const width = Zotero.Prefs.get(`${config.addonRef}.windowWidth`) as string
    const height = Zotero.Prefs.get(`${config.addonRef}.windowHeight`) as string
    return {
      width: /^\d+px$/.test(width || "") ? width : "",
      height: /^\d+px$/.test(height || "") ? height : "",
    }
  }

  private saveContainerSize(width: number, height: number) {
    Zotero.Prefs.set(`${config.addonRef}.windowWidth`, `${Math.round(width)}px`)
    Zotero.Prefs.set(`${config.addonRef}.windowHeight`, `${Math.round(height)}px`)
  }

  private clampContainerSize(width: number, height: number, left: number, top: number) {
    const minWidth = 360
    const minHeight = 180
    const maxWidth = Math.max(minWidth, window.innerWidth - left)
    const maxHeight = Math.max(minHeight, window.innerHeight - top)
    return {
      width: Math.min(Math.max(minWidth, width), maxWidth),
      height: Math.min(Math.max(minHeight, height), maxHeight),
    }
  }

  private applyContainerSize(width: number, height: number) {
    const left = this.container.offsetLeft
    const top = this.container.offsetTop
    const clamped = this.clampContainerSize(width, height, left, top)
    this.container.style.width = `${Math.round(clamped.width)}px`
    this.container.style.height = `${Math.round(clamped.height)}px`
    this.syncTagTrayAlignment()
  }

  private parseTrigger(trigger: string) {
    if (!(trigger.startsWith("/") && trigger.lastIndexOf("/") > 0)) {
      return null
    }
    const lastSlash = trigger.lastIndexOf("/")
    const pattern = trigger.slice(1, lastSlash)
    const flags = trigger.slice(lastSlash + 1)
    if (!/^[dgimsuy]*$/.test(flags)) {
      return null
    }
    try {
      return new RegExp(pattern, flags)
    } catch {
      return null
    }
  }

  private async resolvePlaceholder(name: string) {
    switch (name) {
      case "input":
        return Meet.Global.input || ""
      case "pdf_selection":
        return Meet.Zotero.getPDFSelection()
      case "full_pdf_text":
        return await Meet.Zotero.getFullPDFText()
      case "clipboard":
        return Meet.Zotero.getClipboardText()
      case "selected_item_json": {
        const item = ZoteroPane.getSelectedItems()[0]
        return item ? JSON.stringify(item.toJSON()) : ""
      }
      case "pdf_annotations":
        return await Meet.Zotero.getPDFAnnotations(false)
      case "selected_pdf_annotations":
        return await Meet.Zotero.getPDFAnnotations(true)
      case "related_text":
        return await Meet.Zotero.getRelatedText(Meet.Global.input || "")
      default:
        if (name.startsWith("selected_item_field:")) {
          const fieldName = name.slice("selected_item_field:".length)
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)) {
            throw new Error(`Unsupported placeholder: {{${name}}}`)
          }
          return Meet.Zotero.getItemField(fieldName) || ""
        }
        throw new Error(`Unsupported placeholder: {{${name}}}`)
    }
  }

  private isSupportedPlaceholder(name: string) {
    return [
      "input",
      "pdf_selection",
      "full_pdf_text",
      "clipboard",
      "selected_item_json",
      "pdf_annotations",
      "selected_pdf_annotations",
      "related_text"
    ].includes(name) || (
      name.startsWith("selected_item_field:") &&
      /^[A-Za-z][A-Za-z0-9_]*$/.test(name.slice("selected_item_field:".length))
    )
  }

  private getPlaceholderMatches(text: string) {
    return [...text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)]
  }

  private async resolvePlaceholders(text: string, strict: boolean = true) {
    if (/\$\{[\s\S]+?\}/.test(text) || /```j(?:ava)?s(?:cript)?/i.test(text)) {
      throw new Error("Legacy JavaScript tag syntax is no longer supported. Use safe placeholders like {{input}} or {{pdf_selection}}.")
    }
    const placeholders = this.getPlaceholderMatches(text)
    for (const match of placeholders) {
      const rawString = match[0]
      const placeholder = match[1]
      if (!this.isSupportedPlaceholder(placeholder)) {
        if (strict) {
          throw new Error(`Unsupported placeholder: {{${placeholder}}}`)
        }
        continue
      }
      text = text.replace(rawString, await this.resolvePlaceholder(placeholder))
    }
    return text
  }

  private async addAutomaticContext(
    text: string,
    placeholders: string[] = this.getPlaceholderMatches(text).map(match => match[1])
  ) {
    const hasExplicitPdfContextPlaceholder = placeholders.some((name) => [
      "pdf_selection",
      "full_pdf_text",
      "related_text",
      "pdf_annotations",
      "selected_pdf_annotations"
    ].includes(name))
    const blocks: string[] = []
    const selectedText = Meet.Zotero.getPDFSelection().trim()
    const shouldRequestFullPdfContext = /\b(this paper|this article|paper|article|study|document|manuscript)\b/i.test(text)
    this.logDebug("addAutomaticContext:start", {
      textLength: text.length,
      hasExplicitPdfContextPlaceholder,
      selectedTextLength: selectedText.length,
      hasOpenPDF: Meet.Zotero.hasOpenPDF(),
      shouldRequestFullPdfContext
    })

    if (selectedText.length > 0 && !hasExplicitPdfContextPlaceholder) {
      blocks.push(`Selected text:\n${selectedText}`)
    }

    if (Meet.Zotero.hasOpenPDF() && !hasExplicitPdfContextPlaceholder) {
      this.logDebug("addAutomaticContext:relatedText:start", {
        inputLength: (Meet.Global.input || "").length,
        shouldRequestFullPdfContext
      })
      const relatedText = shouldRequestFullPdfContext
        ? (await Meet.Zotero.getRelatedText(Meet.Global.input || "", {
          insertAuxiliary: false,
          cachedOnly: false
        })).trim()
        : (
          await Promise.race<string>([
            Meet.Zotero.getRelatedText(Meet.Global.input || "", {
              insertAuxiliary: false,
              cachedOnly: true
            }),
            new Promise((resolve) => {
              window.setTimeout(() => resolve(""), 1500)
            })
          ])
        ).trim()
      this.logDebug("addAutomaticContext:relatedText:done", {
        relatedTextLength: relatedText.length
      })
      if (relatedText.length > 0) {
        blocks.push(`Context from the open PDF:\n${relatedText}`)
      }
    }

    if (blocks.length == 0) {
      this.logDebug("addAutomaticContext:done", { blockCount: 0, resultLength: text.length })
      return text
    }

    const result = `Context information is below.\n\n${blocks.join("\n\n")}\n\nUsing the provided context information, answer the user's question.\n\nQuestion: ${text}`
    this.logDebug("addAutomaticContext:done", { blockCount: blocks.length, resultLength: result.length })
    return result
  }

  private isLegacyTagText(text: string) {
    return (
      /\$\{[\s\S]+?\}/.test(text) ||
      /```j(?:ava)?s(?:cript)?/i.test(text) ||
      /\bwindow\.gptInputString\b/.test(text) ||
      /\bZotero\.ZoteroGPT\b/.test(text)
    )
  }

  private rebuildDefaultTag(defaultTag: Tag, currentTag: Tag) {
    const body = defaultTag.text.replace(/^#.+\n/, "")
    const position = typeof currentTag.position == "number" ? currentTag.position : defaultTag.position
    const color = currentTag.color || defaultTag.color
    const trigger = currentTag.trigger?.length ? currentTag.trigger : defaultTag.trigger
    return parseTag(`#${defaultTag.tag}[position=${position}][color=${color}][trigger=${trigger}]\n${body}`)
  }

  private normalizeTags(tags: Tag[]) {
    let changed = false
    const activeTags = tags.filter((tag: Tag) => {
      if (!retiredDefaultTagNames.includes(tag.tag)) {
        return true
      }
      changed = true
      this.logDebug("getTags:removeRetiredDefaultTag", { tag: tag.tag })
      return false
    })
    const normalizedTags = activeTags.map((originalTag) => {
      const renamedTagName = renamedDefaultTagNames[originalTag.tag] || originalTag.tag
      let tag = originalTag
      if (renamedTagName != originalTag.tag) {
        changed = true
        tag = { ...originalTag, tag: renamedTagName }
        this.logDebug("getTags:renameDefaultTag", {
          from: originalTag.tag,
          to: renamedTagName
        })
      }
      const defaultTag = defaultTags.find((candidate: Tag) => candidate.tag == tag.tag)
      if (!defaultTag) {
        return tag
      }
      const shouldMigrateLegacyText = this.isLegacyTagText(tag.text || "")
      const shouldRestoreTrigger = !tag.trigger?.length && !!defaultTag.trigger?.length
      const shouldSyncDefaultText =
        tag.tag == "🪐AskPDF" ||
        renamedTagName != originalTag.tag
          ? tag.text != this.rebuildDefaultTag(defaultTag, tag).text
          : false
      if (!shouldMigrateLegacyText && !shouldRestoreTrigger && !shouldSyncDefaultText) {
        return tag
      }
      changed = true
      const migratedTag = this.rebuildDefaultTag(defaultTag, tag)
      this.logDebug("getTags:migrateDefaultTag", {
        tag: tag.tag,
        shouldMigrateLegacyText,
        shouldRestoreTrigger,
        shouldSyncDefaultText
      })
      return migratedTag
    })
    const dedupedTags: Tag[] = []
    const seenTags = new Set<string>()
    normalizedTags.forEach((tag) => {
      if (seenTags.has(tag.tag)) {
        changed = true
        this.logDebug("getTags:dedupeDefaultTag", { tag: tag.tag })
        return
      }
      seenTags.add(tag.tag)
      dedupedTags.push(tag)
    })
    for (let defaultTag of defaultTags) {
      if (!dedupedTags.find((tag: Tag) => tag.tag == defaultTag.tag)) {
        dedupedTags.push(defaultTag)
        changed = true
      }
    }
    return { tags: dedupedTags, changed }
  }

  /**
   * Generated drag handler
   */
  private addDragEvent(node: HTMLDivElement) {
    let offsetX = 0
    let offsetY = 0
    let isDragging: boolean = false

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      // Skip drag logic for input, textarea, and tag elements
      if (
        event.target instanceof window.HTMLInputElement ||
        event.target instanceof window.HTMLTextAreaElement ||
        target.closest("[data-no-drag=true]") ||
        (event.target as HTMLDivElement).classList.contains("tag") ||
        target.closest("#output-container")
      ) {
        return
      }
      const rect = node.getBoundingClientRect()
      offsetX = event.clientX - rect.left
      offsetY = event.clientY - rect.top
      isDragging = true
      event.preventDefault()
    }

    const handleMouseUp = () => {
      isDragging = false
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) {
        let currentX = event.clientX - offsetX
        let currentY = event.clientY - offsetY
        const maxX = Math.max(0, window.innerWidth - node.offsetWidth)
        const maxY = Math.max(0, window.innerHeight - node.offsetHeight)
        currentX = Math.min(Math.max(0, currentX), maxX)
        currentY = Math.min(Math.max(0, currentY), maxY)
        node.style.left = currentX + "px"
        node.style.top = currentY + "px"
      }
    }

    // Add event listeners
    node.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("mouseup", handleMouseUp)
    document.addEventListener("mousemove", handleMouseMove)
  }

  private addResizeEvent(node: HTMLDivElement, handle: HTMLDivElement) {
    let startWidth = 0
    let startHeight = 0
    let startX = 0
    let startY = 0
    let isResizing = false

    const handleMouseDown = (event: MouseEvent) => {
      isResizing = true
      startWidth = node.offsetWidth
      startHeight = node.offsetHeight
      startX = event.clientX
      startY = event.clientY
      event.preventDefault()
      event.stopPropagation()
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) {
        return
      }
      const width = startWidth + (event.clientX - startX)
      const height = startHeight + (event.clientY - startY)
      this.applyContainerSize(width, height)
    }

    const handleMouseUp = () => {
      if (!isResizing) {
        return
      }
      isResizing = false
      this.saveContainerSize(node.offsetWidth, node.offsetHeight)
    }

    handle.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }


  /**
   * Generated history key handler
   */
  private bindUpDownKeys(inputNode: HTMLInputElement) {
    // let currentIdx = this._history.length;
    inputNode.addEventListener("keydown", (e) => {
      this._history = this._history.filter(i=>i.input)
      let currentIdx = this._history.map(i=>i.input).indexOf(this.inputContainer!.querySelector("input")!.value)
      currentIdx = currentIdx == -1 ? this._history.length : currentIdx
      if (e.key === "ArrowUp") {
        currentIdx--;
        if (currentIdx < 0) {
          currentIdx = 0;
        }
        inputNode.value = this._history[currentIdx].input || "";
        this.setText(this._history[currentIdx].output, true, false, false)
      } else if (e.key === "ArrowDown") {
        currentIdx++;
        if (currentIdx >= this._history.length) {
          currentIdx = this._history.length;
          inputNode.value = "";
          this.outputContainer.style.display = "none"
        } else {
          inputNode.value = this._history[currentIdx].input || "";
          this.setText(this._history[currentIdx].output, true, false, false)
        }
      }
      if (["ArrowDown", "ArrowUp"].indexOf(e.key) >= 0) {
        e.stopPropagation();
        e.preventDefault();
        inputNode.setSelectionRange(inputNode.value.length, inputNode.value.length);
      }
    });
  }

  /**
   * Bind Ctrl+wheel zoom on the container
   */
  private bindCtrlScrollZoom(div: HTMLDivElement) {
      // Bind wheel events for the target div
    div.addEventListener('DOMMouseScroll', (event: any) => {
      // Check whether Ctrl or Meta is pressed
      if (event.ctrlKey || event.metaKey) {
        let _scale = div.style.transform.match(/scale\((.+)\)/)
        let scale = _scale ? parseFloat(_scale[1]) : 1
        let minScale = 0.5, maxScale = 2, step = 0.05
        if (div.style.bottom == "0px") {
          div.style.transformOrigin = "center bottom"
        } else {
          div.style.transformOrigin = "center center"
        }
        if (event.detail > 0) {
          // Zoom out
          scale = scale - step
          div.style.transform = `scale(${scale < minScale ? minScale : scale})`;
        } else {
          // Zoom in
          scale = scale + step
          div.style.transform = `scale(${scale > maxScale ? maxScale : scale})`;
        }
      }
    })
  }

  /**
   * Bind Ctrl+wheel zoom for all output children
   */
  private bindCtrlScrollZoomOutput(div: HTMLDivElement) {
    const styleAttributes = {
      fontSize: 'font-size',
      lineHeight: 'line-height',
      marginBottom: 'margin-bottom',
      marginTop: 'margin-top',
      paddingBottom: 'padding-bottom',
      paddingTop: 'padding-top',
    } as const;
    type StyleAttributeKeys = keyof typeof styleAttributes;
    type StyleAttributes = {
      [K in StyleAttributeKeys]: string;
    };
    // Read initial child styles
    const getChildStyles = (child: Element): StyleAttributes => {
      const style = window.getComputedStyle(child);
      const result: Partial<StyleAttributes> = {};
      for (const key in styleAttributes) {
        const typedKey = key as StyleAttributeKeys;
        result[typedKey] = style.getPropertyValue(styleAttributes[typedKey]);
      }
      return result as StyleAttributes;
    };
  
    // Update and apply child styles
    const applyNewStyles = (child: HTMLElement, style: StyleAttributes, scale: number) => {
      const newStyle = (value: string) => parseFloat(value) * scale + 'px';
  
      for (const key in styleAttributes) {
        child.style && (child.style[key as StyleAttributeKeys] = newStyle(style[key as StyleAttributeKeys]))
      }
    };
    // Bind wheel events for the target div
    div.addEventListener('DOMMouseScroll', (event: any) => {
      const children = div.children[0].children;
      if (event.ctrlKey || event.metaKey) {
        const step = 0.05;
        event.preventDefault();
        // Stop propagation
        event.stopPropagation();
        const scale = event.detail > 0 ? 1 - step : 1 + step;
        Array.from(children).forEach((child) => {
          const childElement = child as HTMLElement;
          const currentStyle = getChildStyles(child);
          applyNewStyles(childElement, currentStyle, scale);
        });
      }
    });
  }

  private buildContainer() {
    const storedSize = this.getStoredContainerSize()
    // Root container
    const container = ztoolkit.UI.createElement(document, "div", {
      id: this.id,
      classList: ["gpt-shell"],
      styles: {
        display: "none",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        position: "fixed",
        width: storedSize.width || Zotero.Prefs.get(`${config.addonRef}.width`) as string,
        height: storedSize.height || "auto",
        minWidth: "360px",
        minHeight: "180px",
        maxWidth: "calc(100vw - 8px)",
        maxHeight: "calc(100vh - 8px)",
        fontSize: "16px",
        fontFamily: fontFamily,
        overflow: "hidden",
      }
    })
    this.addDragEvent(container)
    this.bindCtrlScrollZoom(container)
    ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["gpt-header"],
      children: [
        {
          tag: "div",
          classList: ["gpt-title-wrap"],
          children: [
            {
              tag: "div",
              classList: ["gpt-title"],
              properties: {
                innerText: "ZoteroGPT"
              }
            },
            {
              tag: "div",
              classList: ["gpt-subtitle"],
              properties: {
                innerText: "Ask items, PDFs, and saved tags"
              }
            }
          ]
        },
        {
          tag: "div",
          classList: ["gpt-header-actions"],
          children: [
            {
              tag: "div",
              classList: ["gpt-status-pill"],
              listeners: [],
            },
            {
              tag: "button",
              classList: ["gpt-icon-button"],
              properties: {
                innerText: "\u00D7",
                title: "Close"
              },
              styles: {
                appearance: "none",
                border: "none",
                background: "transparent"
              },
              listeners: [
                {
                  type: "click",
                  listener: () => this.closeWindow()
                }
              ]
            }
          ]
        }
      ]
    }, container)
    this.statusPill = container.querySelector(".gpt-status-pill") as HTMLDivElement
    // Input area
    const inputContainer = this.inputContainer = ztoolkit.UI.appendElement({
      tag: "div",
      id: "input-container",
      classList: ["gpt-composer"],
      styles: {
        width: "100%",
        display: "flex",
        justifyContent: "center",
        flexDirection: "column",
        alignItems: "center",
      },
      children: [
        {
          tag: "input",
          classList: ["gpt-text-input"],
          styles: {
            width: "calc(100% - 2em)",
            height: "2.75em",
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: ".8em",
          }
          ,
          properties: {
            placeholder: "Ask about the current item, selection, or open PDF"
          }
        },
        {
          tag: "textarea",
          classList: ["gpt-textarea"],
          styles: {
            display: "none",
            width: "calc(100% - 2em)",
            maxHeight: "20em",
            minHeight: "3.5em",
            border: "none",
            outline: "none",
            resize: "vertical",
            marginTop: "0.4em",
            background: "transparent",
            fontSize: ".8em"

          },
          properties: {
            placeholder: "Write a longer prompt or tag template here"
          }
        }
      ]

    }, container) as HTMLDivElement
    const inputNode = inputContainer.querySelector("input")!
    this.bindUpDownKeys(inputNode)
    const textareaNode = inputContainer.querySelector("textarea")!
    const that = this;
    let lastInputText = ""
    let inputListener = function (event: KeyboardEvent) {
      // @ts-ignore
      if(this.style.display == "none") { return }
      // @ts-ignore
      let text = Meet.Global.input = this.value
      if ((event.ctrlKey || event.metaKey) && ["s", "r"].indexOf(event.key) >= 0 && textareaNode.style.display != "none") {
        // Always save first, but do not always run
        const tag = parseTag(text)
        if (tag) {
          // @ts-ignore
          this.value = tag.text
          let tags = that.getTags()
          // If a tag already exists, remove the old version before updating
          tags = tags.filter((_tag: Tag) => {
            return _tag.tag != tag.tag
          })
          tags.push(tag)
          that.setTags(tags)
          that.renderTags();
          if (event.key == "s") {
            new ztoolkit.ProgressWindow("Save Tag")
              .createLine({ text: tag.tag, type: "success" })
              .show()
            return
          }
          // Run the tag template and save it
          if (event.key == "r") {
            return that.execTag(tag)
          }
        }
        // Plain text
        else {
          // Run long text as an unsaved tag template
          if (event.key == "r") {
            return that.execTag({tag: "Untitled", position: -1, color: "", trigger: "", text})
          }
        }
      }
      if (event.key == "Enter") { 
        ztoolkit.log(event)
        
        outputContainer.querySelector(".auxiliary")?.remove()

        // Ctrl+Enter reruns the first matching tag
        if (event.ctrlKey || event.metaKey) {
          // Find the first clickable tag
          ztoolkit.log("Ctrl + Enter")
          let tag = that._tag || that.getTags()[0]
          return that.execTag(tag)
        }
        // Shift+Enter switches to multiline mode, then Ctrl+R runs it
        if (event.shiftKey) {
          if (inputNode.style.display != "none") {
            inputNode.style.display = "none"
            textareaNode.style.display = ""
            textareaNode.focus()
            textareaNode.value = text + "\n"
          }
          return
        }
        // Highest priority to avoid IME enter-key conflicts
        if (text.length != lastInputText.length) {
          lastInputText = text
          return
        }
        if (text.startsWith("#")) {
          if (inputNode.style.display != "none") {
            inputNode.style.display = "none"
            textareaNode.style.display = ""
            textareaNode.focus()
            // Check whether the tag already exists locally
            const tags = that.getTags();
            const tag = tags.find((tag: any) => tag.text.startsWith(text.split("\n")[0]))
            if (tag) {
              textareaNode.value = tag.text
            } else {
              textareaNode.value = text + "\n"
            }
          }
        } else if (text.startsWith("/")) {
          that._history.push(text)
          // Try to stop any other active streams
          // that._id = undefined
          that.stopAlloutput()
          text = text.slice(1)
          let [key, value] = text.split(" ")
          if (key == "clear") {
            that.messages = []
            // @ts-ignore
            this.value = ""
            that.setStatus("idle")
            that.setOutputState("empty", {
              title: "Conversation cleared",
              message: "Ask another question about a selected item, open PDF, or saved tag."
            })
          } else if (key == "help"){ 
            that.setText(help, true, false)
          } else if (key == "report") { 
            const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`) as string
            const maskedKey = secretKey ? `${secretKey.slice(0, 3)}...${secretKey.slice(-4)}` : "(not set)"
            return that.setText(`\`api\` ${Zotero.Prefs.get(`${config.addonRef}.api`)}\n\`secretKey\` ${maskedKey}\n\`model\` ${Zotero.Prefs.get(`${config.addonRef}.model`)}\n\`temperature\` ${Zotero.Prefs.get(`${config.addonRef}.temperature`)}`, true, false)
          } else if (["secretKey", "model", "api", "temperature", "deltaTime", "width", "tagsMore", "chatNumber", "relatedNumber"].indexOf(key) >= 0) {  
            if (value?.length > 0) {
              if (value == "default") {
                Zotero.Prefs.clear(`${config.addonRef}.${key}`)
                value = Zotero.Prefs.get(`${config.addonRef}.${key}`)
                that.setText(`${key} = ${value}`, true, false)
                return 
              }
              switch (key) {
                case "deltaTime":
                case "relatedNumber":
                case "chatNumber":
                  Zotero.Prefs.set(`${config.addonRef}.${key}`, Number(value))
                  break;
                case "width":
                  ztoolkit.log("width", value.match(/^[\d\.]+%$/))
                  if (value.match(/^[\d\.]+%$/)) {
                    that.container.style.width = value
                    that.container.style.height = that.container.style.height || "auto"
                    Zotero.Prefs.set(`${config.addonRef}.${key}`, value)
                    Zotero.Prefs.clear(`${config.addonRef}.windowWidth`)
                    break;
                  } else {
                    ztoolkit.log("width Error")
                    return that.setText(`Invalid value, ${value}, please enter a percentage, for example \`32 %\`.`, true, false)
                  }
                case "tagsMore":
                  if (["scroll", "expand"].indexOf(value) >= 0) {
                    Zotero.Prefs.set(`${config.addonRef}.${key}`, value)
                    break;
                  } else {
                    ztoolkit.log("tagsMore Error")
                    return that.setText(`Invalid value, ${value}, please enter \`expand\` or \`scroll\`.`, true, false)
                  }
                default: 
                  Zotero.Prefs.set(`${config.addonRef}.${key}`, value)
                  break
              }
            } else {
              value = Zotero.Prefs.get(`${config.addonRef}.${key}`)
            }
            that.setText(`${key} = ${value}`, true, false)
            // @ts-ignore
            this.value = ""
          } else {
            that.setText(help, true, false)
            const mdbody = that.outputContainer.querySelector(".markdown-body") as HTMLDivElement
            mdbody.innerHTML = `<center><span style="color: #D14D72;font-weight:bold;font-size:20px;">Invalid Command, Please Read this.</span></center>` + mdbody.innerHTML
          }
        } else {
          that.execText(text)
          that._history.push(text)
        }
      } else if (event.key == "Escape") {
        outputContainer.style.display = "none"
        // Exit multiline mode
        if (textareaNode.style.display != "none") {
          textareaNode.style.display = "none"
          inputNode.value = ""
          inputNode.style.display = ""
          inputNode.focus()
          return
        }
        if (inputNode.value.length) {
          inputNode.value = ""
          return
        }
        // Close the container
        that.hide()
        that.container!.remove()
      } else if (event.key == "/" && text == "/" && that.container.querySelector("input")?.style.display != "none") {
        const rect = that.container.querySelector("input")!.getBoundingClientRect()
        const commands = ["clear", "help", "report", "secretKey", "model", "api", "temperature", "chatNumber", "relatedNumber" , "deltaTime", "tagsMore", "width"]
        that.createMenuNode(
          { x: rect.left, y: rect.top + rect.height, width: 200, height: 350 / 12 * commands.length  },
          commands.map(name => {
            return {
              name,
              listener: () => {
                // @ts-ignore
                this.value = `/${name}`
              }
            }
          }), [2, 6, 8]
        )
      }
      lastInputText = text
    }
    inputNode.addEventListener("keyup", inputListener)
    textareaNode.addEventListener("keyup", inputListener)
    // Output area
    const outputContainer = this.outputContainer = ztoolkit.UI.appendElement({
      tag: "div",
      id: "output-container",
      classList: ["gpt-response-panel"],
      styles: {
        width: "calc(100% - 1.5em)",
        flex: "1 1 auto",
        minHeight: "8em",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "0.6em 0.8em",
      },
      children: [
        {
          tag: "div",
          classList: ["gpt-empty-state"]
        },
        {
          tag: "div",
          classList: ["markdown-body"],
          styles: {
            fontSize: "0.8em",
            userSelect: "text",
          },
          properties: {
            pureText: ""
          }
        }
      ]
    }, container) as HTMLDivElement
    this.bindCtrlScrollZoomOutput(outputContainer)
    outputContainer.addEventListener("copy", (event: ClipboardEvent) => {
      const selectedText = this.getSelectedOutputText()
      if (!selectedText.length) {
        return
      }
      try {
        event.clipboardData?.setData("text/plain", selectedText)
        event.preventDefault()
        this.logDebug("output:copy:event", { textLength: selectedText.length })
      } catch (error: any) {
        this.logDebug("output:copy:event:error", {
          message: error?.message,
          stack: error?.stack
        })
      }
    })
    this.emptyState = outputContainer.querySelector(".gpt-empty-state") as HTMLDivElement
    // Command tags
    const tagsMore = Zotero.Prefs.get(`${config.addonRef}.tagsMore`) as string
    const tagTray = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["gpt-tag-tray"],
      styles: {
        width: "100%",
      },
      children: [
        {
          tag: "div",
          classList: ["gpt-tag-tray-header"],
          children: [
            {
              tag: "div",
              classList: ["gpt-tag-tray-copy"],
              children: [
                {
                  tag: "div",
                  classList: ["gpt-tag-tray-title"],
                  properties: {
                    innerText: "Command Tags"
                  }
                },
                {
                  tag: "div",
                  classList: ["gpt-tag-tray-subtitle"],
                  properties: {
                    innerText: "Click to run. Hold to edit. Right-click to remove."
                  }
                }
              ]
            },
            {
              tag: "button",
              classList: ["gpt-tag-toggle"],
              properties: {
                type: "button",
                innerText: "Hide Tags"
              },
              styles: {
                appearance: "none",
                border: "none",
                background: "transparent"
              },
              listeners: [
                {
                  type: "click",
                  listener: () => this.setTagTrayCollapsed(!this.getTagTrayCollapsed())
                }
              ]
            }
          ]
        }
      ]
    }, container) as HTMLDivElement
    this.dotsContainer = tagTray.querySelector(".gpt-tag-toggle") as HTMLDivElement
    this.dotsContainer.setAttribute("data-no-drag", "true")
    const closeButton = container.querySelector(".gpt-icon-button") as HTMLButtonElement
    closeButton.setAttribute("data-no-drag", "true")
    closeButton.setAttribute("aria-label", "Close ZoteroGPT")
    const tagsContainer = this.tagsContainer = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["tags-container"],
      styles: {
        width: "calc(100% - 1.5em)",
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        margin: ".15em auto .55em",
        flexWrap: tagsMore == "expand" ? "wrap" : "nowrap",
        overflow: "hidden",
        height: "auto",
      },
      listeners: [
        {
          type: "DOMMouseScroll",
          listener: (event: any) => {
            if (tagsMore == "expand") { return }
            const scrollSpeed = 80
            // @ts-ignore
            if (event.detail > 0) {
              tagsContainer.scrollLeft += scrollSpeed
            } else {
              tagsContainer.scrollLeft -= scrollSpeed
            }
            event.preventDefault()
            event.stopPropagation()
          }
        }
      ]
    }, tagTray) as HTMLDivElement
    this.resizeHandle = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["resize-handle"],
      properties: {
        title: "Resize window"
      }
    }, container) as HTMLDivElement
    this.addResizeEvent(container, this.resizeHandle)
    document.documentElement.append(container)
    this.renderTags()
    this.syncThemeMode()
    this.syncTagTrayCollapsed()
    this.setStatus("idle")
    this.setOutputState("empty")
    // Focus
    window.setTimeout(() => {
      container.focus()
      inputContainer.focus()
      inputNode.focus()
    })
    return container
  }

  /**
   * Render tags sorted by position
   */
  private renderTags() {
    this.tagsContainer!?.querySelectorAll("div").forEach(e=>e.remove())
    let tags = this.getTags() as Tag[]
    tags.forEach((tag: Tag, index: number) => {
      this.addTag(tag, index)
    })
    this.syncTagTrayAlignment()
  }

  /**
   * Add a single tag
   */
  private addTag(tag: Tag, index: number) {
    let [red, green, blue] = this.utils.getRGB(tag.color)
    let timer: undefined | number;
    ztoolkit.UI.appendElement({
      tag: "div",
      id: `tag-${index}`,
      classList: ["tag", "gpt-tag-chip"],
      styles: {
        display: "inline-flex",
        flexShrink: "0",
        fontSize: "0.8em",
        minHeight: "2em",
        color: `rgba(${red}, ${green}, ${blue}, 1)`,
        backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.12)`,
        borderRadius: "999px",
        border: `1px solid rgba(${red}, ${green}, ${blue}, 0.16)`,
        margin: ".16em .18em",
        padding: "0 .9em",
        cursor: "pointer",
        whiteSpace: "nowrap",
        alignItems: "center",
        transition: "transform .15s ease, box-shadow .18s ease, background-color .18s ease",
      },
      properties: {
        innerHTML: tag.tag
      },
      listeners: [
        {
          type: "mousedown",
          listener: (event: any) => {
            timer = window.setTimeout(() => {
              timer = undefined
              if (event.buttons == 1) {                
                // Enter edit mode
                const textareaNode = this.inputContainer?.querySelector("textarea")!
                const inputNode = this.inputContainer?.querySelector("input")!
                inputNode.style.display = "none";
                textareaNode.style.display = ""
                textareaNode.value = tag.text
                this.outputContainer.style!.display = "none"
              } else if (event.buttons == 2) {
                let tags = this.getTags()
                tags = tags.filter((_tag: Tag) => _tag.tag != tag.tag)
                this.setTags(tags)
                this.renderTags();
              }
            }, 1000)
          }
        },
        {
          type: "mouseup",
          listener: async () => {
            if (timer) {
              window.clearTimeout(timer)
              timer = undefined
              this.outputContainer.querySelector(".auxiliary")?.remove()
              await this.execTag(tag)
            }
          }
        }
      ]
    }, this.tagsContainer!) as HTMLDivElement
  }

  private rippleEffect(div: HTMLDivElement, color: string) {
    let [red, green, blue] = this.utils.getRGB(color)
    ztoolkit.UI.appendElement({
      tag: "div",
      styles: {
        backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.5)`
      },
      classList: ["ripple"]
    }, div)
  }
  /**
   * Execute a tag
   */
  private async execTag(tag: Tag) {
    this.logDebug("execTag:start", {
      tag: tag.tag,
      inputLength: (this.inputContainer.querySelector("input")?.value || "").length
    })
    Meet.Global.input = this.inputContainer.querySelector("input")?.value as string
    this._tag = tag
    const previousPopupWin = Meet.Global.popupWin
    const popunWin = new ztoolkit.ProgressWindow(tag.tag, { closeTime: -1, closeOtherProgressWindows: true })
      .show()
    this.logDebug("execTag:popup:show", {
      hasPopupWin: !!popunWin,
      hasCreateLine: !!(popunWin as any)?.createLine
    })
    Meet.Global.popupWin = popunWin
    this.safePopupLine(popunWin, "execTag:popup", { text: "Generating input content...", type: "default" })
    this.setStatus("loading", "Preparing tag")
    this.setOutputState("loading", {
      title: `Running ${tag.tag}`,
      message: "Resolving placeholders and preparing the request."
    })
    ztoolkit.log(tag, this.getTags())
    const tagIndex = this.getTags().map(JSON.stringify).indexOf(JSON.stringify(tag)) as number
    this.rippleEffect(
      this.container.querySelector(`#tag-${tagIndex}`)!,
      tag.color
    )
    const outputDiv = this.outputContainer.querySelector(".markdown-body") as HTMLDivElement
    outputDiv.innerHTML = ""
    outputDiv.setAttribute("pureText", "");
    let text = tag.text.replace(/^#.+\n/, "")
    try {
      this.logDebug("execTag:resolvePlaceholders:start", { textLength: text.length })
      text = await this.resolvePlaceholders(text, true)
      this.logDebug("execTag:resolvePlaceholders:done", { textLength: text.length })
    } catch (error: any) {
      this.safePopupLine(popunWin, "execTag:popup", { text: error.message, type: "fail" })
      this.safeStartCloseTimer(popunWin, "execTag:popup", 3000)
      this.showError("Unsafe Tag Blocked", error.message)
      Meet.Global.popupWin = previousPopupWin
      return
    }
    try {
      this.safePopupLine(popunWin, "execTag:popup", { text: `Characters ${text.length}`, type: "success" })
      this.safePopupLine(popunWin, "execTag:popup", { text: "Answering...", type: "default" })
      this.logDebug("execTag:getGPTResponse:start", { textLength: text.length })
      text = await Meet.OpenAI.getGPTResponse(text) as string
      this.logDebug("execTag:getGPTResponse:done", { textLength: text.length })
      if (text.trim().length) {
        this.safePopupLine(popunWin, "execTag:popup", { text: "Done", type: "success" })
        this.setStatus("success", "Answer ready")
      } else {
        this.safePopupLine(popunWin, "execTag:popup", { text: "Done", type: "fail" })
        this.setStatus("error", "Empty response")
      }
    } catch (error: any) {
      const message = error?.message || "The request did not complete."
      this.safePopupLine(popunWin, "execTag:popup", { text: message, type: "fail" })
      this.showError("Request Error", message)
    } finally {
      this.logDebug("execTag:finally", "")
      this.safeStartCloseTimer(popunWin, "execTag:popup", 3000)
      Meet.Global.popupWin = previousPopupWin
    }
  }

  /**
   * Execute the current input text
   */
  private async execText(text: string) {
    this.logDebug("execText:start", {
      textLength: text.length,
      hasOpenPDF: Meet.Zotero.hasOpenPDF(),
      selectedTextLength: Meet.Zotero.getPDFSelection().trim().length
    })
    // If input matches a tag trigger, run that tag instead
    const tag = this.getTags()
      .filter((tag: Tag) => tag.trigger?.length > 0)
      .find((tag: Tag) => {
      const trigger = tag.trigger
      if (trigger.startsWith("/") && trigger.endsWith("/")) {
        const regex = this.parseTrigger(trigger)
        return regex ? regex.test(text) : text.indexOf(trigger) >= 0
      } else {
        return text.indexOf(trigger as string) >= 0
      }
    })
    if (tag) { return this.execTag(tag) }

    // Otherwise execute the input as plain text
    if (text.trim().length == 0) { return }
    this.setOutputState("loading", {
      title: "Generating response",
      message: "Preparing context from Zotero and waiting for the model."
    })
    const outputDiv = this.outputContainer.querySelector(".markdown-body") as HTMLDivElement
    outputDiv.innerHTML = ""
    outputDiv.setAttribute("pureText", "");
    this.setStatus("loading", "Preparing request")
    const placeholderNames = this.getPlaceholderMatches(text).map(match => match[1])
    const hasSupportedPlaceholders = placeholderNames
      .some(name => this.isSupportedPlaceholder(name))
    const shouldBuildContext = hasSupportedPlaceholders || Meet.Zotero.hasOpenPDF() || Meet.Zotero.getPDFSelection().trim().length > 0
    const previousPopupWin = Meet.Global.popupWin
    const popupWin = shouldBuildContext
      ? new ztoolkit.ProgressWindow("Input Context", { closeTime: -1, closeOtherProgressWindows: true }).show()
      : undefined
    this.logDebug("execText:popup:show", {
      shouldBuildContext,
      hasPopupWin: !!popupWin,
      hasCreateLine: !!(popupWin as any)?.createLine
    })
    if (popupWin) {
      Meet.Global.popupWin = popupWin
      this.safePopupLine(popupWin, "execText:popup", { text: "Generating input content...", type: "default" })
    }
    try {
      this.logDebug("execText:resolvePlaceholders:start", { textLength: text.length })
      text = await this.resolvePlaceholders(text, false)
      this.logDebug("execText:resolvePlaceholders:done", { textLength: text.length })
      this.logDebug("execText:addAutomaticContext:start", { textLength: text.length })
      text = await this.addAutomaticContext(text, placeholderNames)
      this.logDebug("execText:addAutomaticContext:done", { textLength: text.length })
    } catch (error: any) {
      this.safePopupLine(popupWin, "execText:popup", { text: error.message, type: "fail" })
      this.safeStartCloseTimer(popupWin, "execText:popup", 3000)
      this.showError("Placeholder Error", error.message)
      Meet.Global.popupWin = previousPopupWin
      return
    }
    try {
      this.safePopupLine(popupWin, "execText:popup", { text: `Characters ${text.length}`, type: "success" })
      this.safePopupLine(popupWin, "execText:popup", { text: "Answering...", type: "default" })
      this.logDebug("execText:getGPTResponse:start", { textLength: text.length })
      text = await Meet.OpenAI.getGPTResponse(text)
      this.logDebug("execText:getGPTResponse:done", { textLength: text.length })
      this.safePopupLine(popupWin, "execText:popup", { text: "Done", type: text.trim().length ? "success" : "fail" })
      this.setStatus(text.trim().length ? "success" : "error", text.trim().length ? "Answer ready" : "Empty response")
    } catch (error: any) {
      const message = error?.message || "The request did not complete."
      this.safePopupLine(popupWin, "execText:popup", { text: message, type: "fail" })
      this.showError("Request Error", message)
    } finally {
      this.logDebug("execText:finally", "")
      this.safeStartCloseTimer(popupWin, "execText:popup", 3000)
      Meet.Global.popupWin = previousPopupWin
    }
  }

  /**
   * Read saved tags from Zotero.Prefs and return them sorted by position
   */
  private getTags() {
    // Work around prefs parsing issues caused by Unicode content
    let tagsJson
    try {
      tagsJson = Zotero.Prefs.get(`${config.addonRef}.tags`) as string
    } catch {}
    if (!tagsJson) {
      tagsJson = "[]"
      Zotero.Prefs.set(`${config.addonRef}.tags`, tagsJson)
    }
    let tags = JSON.parse(tagsJson)
    const normalized = this.normalizeTags(tags)
    tags = normalized.tags
    if (normalized.changed) {
      Zotero.Prefs.set(`${config.addonRef}.tags`, JSON.stringify(tags))
    }
    return (tags.length > 0 ? tags : defaultTags).sort((a: Tag, b: Tag) => a.position - b.position)
  }

  private setTags(tags: any[]) {
    Zotero.Prefs.set(`${config.addonRef}.tags`, JSON.stringify(tags))
  }

  /**
   * Generated positioning helper
   */
  public show(x: number = -1, y: number = -1, reBuild: boolean = true) {
    reBuild = reBuild || !this.container
    if (reBuild) {
      document.querySelectorAll(`#${this.id}`).forEach(e=>e.remove())
      this.container = this.buildContainer()
      this.container.style.display = "flex"
    }
    this.syncThemeMode()
    this.syncTagTrayCollapsed()
    this.container.setAttribute("follow", "")
    if (x + y < 0) {
      const rect = document.documentElement.getBoundingClientRect()
      x = rect.width / 2 - this.container.offsetWidth / 2;
      y = rect.height / 2 - this.container.offsetHeight / 2;
    }
    const clamped = this.clampToViewport(x, y)
    this.container.style.left = `${clamped.x}px`
    this.container.style.top = `${clamped.y}px`
  }

  /**
   * Hide the UI and clear all active intervals
   */
  public hide() {
    this.container.style.display = "none"
    this.setStatus("idle")
    ztoolkit.log(this._ids)
    this._ids.map(id=>id.id).forEach(window.clearInterval)
  }

  public stopAlloutput() {
    this._ids.filter(id => id.type == "output").map(i => i.id).forEach(window.clearInterval)
  }

  /**
   * Insert auxiliary buttons into the output area.
   * This is highly extensible and helps jump to items, PDF passages, and annotations.
   */
  public insertAuxiliary(docs: Document[]) {
    this.outputContainer.querySelector(".auxiliary")?.remove()
    const auxDiv = ztoolkit.UI.appendElement({
      namespace: "html",
      classList: ["auxiliary"],
      tag: "div",
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "0.35em",
        marginTop: "0.35em",
      }
    }, this.outputContainer)
    docs.forEach((doc: Document, index: number) => {
      ztoolkit.UI.appendElement({
        namespace: "html",
        tag: "a",
        classList: ["gpt-aux-link"],
        styles: {
          fontSize: "0.8em",
          cursor: "pointer",
          width: "1.9em",
          height: "1.9em",
          textAlign: "center",
          fontWeight: "bold",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        },
        properties: {
          innerText: index + 1
        },
        listeners: [
          {
            type: "click",
            listener: async () => {
              if (doc.metadata.type == "box") {
                const reader = await ztoolkit.Reader.getReader();
                (reader!._iframeWindow as any).wrappedJSObject.eval(`
                  PDFViewerApplication.pdfViewer.scrollPageIntoView({
                    pageNumber: ${doc.metadata.box.page + 1},
                    destArray: ${JSON.stringify([null, { name: "XYZ" }, doc.metadata.box.left, doc.metadata.box.top, 3.5])},
                    allowNegativeOffset: false,
                    ignoreDestinationZoom: false
                  })
                `)
              } else if (doc.metadata.type == "id") {
                await ZoteroPane.selectItem(doc.metadata.id as number)
              }
            }
          }
        ]
      }, auxDiv as Element)
    })
  }

  /**
   * Create a menu
   */
  public createMenuNode(
    rect: { x: number, y: number, width: number, height: number },
    items: { name: string, listener: Function }[],
    separators: number[]
  ) {
    const theme = this.getThemeMode();
    const isDark = theme == "dark";
    (document.querySelector(".gpt-menu-box") as HTMLDivElement | null)?.remove()
    const removeNode = () => {
      document.removeEventListener("mousedown", removeNode)
      document.removeEventListener("keydown", keyDownHandler)
      window.setTimeout(() => {
        menuNode.remove()
      }, 0)
      this.inputContainer.querySelector("input")?.focus()
    }
    document.addEventListener("mousedown", removeNode)
    let menuNode = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["gpt-menu-box"],
      styles: {
        position: "fixed",
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        display: "flex",
        height: `${rect.height}px`,
        justifyContent: "space-around",
        flexDirection: "column",
        padding: "6px",
        border: isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(15, 23, 42, 0.08)",
        backgroundColor: isDark ? "#1f2631" : "#f8fafc",
        color: isDark ? "#e5edf7" : "#122033",
        borderRadius: "12px",
        boxShadow: isDark
          ? `0px 1px 2px rgba(0, 0, 0, 0.35),
             0px 8px 24px rgba(0, 0, 0, 0.28)`
          : `0px 1px 2px rgba(15, 23, 42, 0.05),
             0px 12px 32px rgba(15, 23, 42, 0.12)`,
        overflow: "hidden",
        userSelect: "none",
      },
      children: (() => {
        let arr = [];
        for (let i = 0; i < items.length; i++) {
          arr.push({
            tag: "div",
            classList: ["menu-item"],
              styles: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "7px 10px",
                cursor: "default",
                fontSize: "13px",
                borderRadius: "8px",
                whiteSpace: "nowrap",
              },
            listeners: [
              {
                type: "mousedown",
                listener: async (event: any) => {
                  await items[i].listener()
                }
              },
              {
                type: "mouseenter",
                listener: function () {
                  nodes.forEach((e: Element) => e.classList.remove("selected"))
                  // @ts-ignore
                  this.classList.add("selected")
                  currentIndex = i
                }
              },
            ],
            children: [
              {
                tag: "div",
                classList: ["menu-item-name"],
                styles: {
                  paddingLeft: "0.5em",
                },
                properties: {
                  innerText: items[i].name
                }
              }
            ]
          })
          if (separators.indexOf(i) != -1) {
            arr.push({
              tag: "div",
              styles: {
                height: "0",
                margin: "6px -6px",
                borderTop: isDark ? ".5px solid rgba(255,255,255,0.08)" : ".5px solid rgba(15, 23, 42, 0.08)",
                borderBottom: isDark ? ".5px solid rgba(255,255,255,0.08)" : ".5px solid rgba(15, 23, 42, 0.08)",
              }
            })
          }

        }
        return arr
      })() as any
    }, document.documentElement) as HTMLDivElement
    
    const winRect = document.documentElement.getBoundingClientRect()
    const nodeRect = menuNode.getBoundingClientRect()
    menuNode.setAttribute("data-theme", theme)
    // Avoid overflow
    if (nodeRect.bottom > winRect.bottom) {
      menuNode.style.top = ""
      menuNode.style.bottom = "0px"
    }
    // menuNode.querySelector(".menu-item:first-child")?.classList.add("selected")
    const nodes = menuNode.querySelectorAll(".menu-item")
    nodes[0].classList.add("selected")
    let currentIndex = 0
    this.inputContainer.querySelector("input")?.blur()
    let keyDownHandler = (event: any) => {
      ztoolkit.log(event)
      if (event.code == "ArrowDown") {
        currentIndex += 1
        if (currentIndex >= nodes.length) {
          currentIndex = 0
        }
      } else if (event.code == "ArrowUp") {
        currentIndex -= 1
        if (currentIndex < 0) {
          currentIndex = nodes.length - 1
        }
      } else if (event.code == "Enter") {
        items[currentIndex].listener()
        
        removeNode()
      } else if (event.code == "Escape") {
        removeNode()
      }
      nodes.forEach((e: Element) => e.classList.remove("selected"))
      nodes[currentIndex].classList.add("selected")
    }
    document.addEventListener("keydown", keyDownHandler)
    return menuNode
  }

  /**
   * Register keyboard shortcuts
   */
  private registerKey() {
    const callback = async () => {
      if (Zotero_Tabs.selectedIndex == 0) {
        const div = document.querySelector("#item-tree-main-default .row.selected")!
        if (div) {
          const rect = div.getBoundingClientRect()
          this.show(rect.x, rect.y + rect.height)
        } else {
          this.show()
        }
      } else {
        const reader = await ztoolkit.Reader.getReader()
        // const div = reader?._iframeWindow?.document.querySelector("#selection-menu")!
        const div = reader?._iframeWindow?.document.querySelector(".selection-popup")!
        if (div) {
          window.setTimeout(() => {
            this.messages = this.messages.concat(
              [
                {
                  role: "user",
                  content: `I am reading a PDF, and the following text is a part of the PDF. Please read it first, and I will ask you some question later: \n${Meet.Zotero.getPDFSelection()}`
                },
                {
                  role: "assistant",
                  content: "OK."
                }
              ]
            )
            const rect = div?.getBoundingClientRect()
            const windRect = document.documentElement.getBoundingClientRect()
            const ww = windRect.width *
              0.01 * Number((Zotero.Prefs.get(`${config.addonRef}.width`) as string).slice(0, -1))
            ww
            this.show(rect.left + rect.width * .5 - ww * .5, rect.bottom)
          }, 233)
        } else {
          this.show()
        }
      }
    }
    if (Zotero.isMac) {
      ztoolkit.Shortcut.register("event", {
        id: config.addonRef,
        modifiers: "meta",
        key: "/",
        callback: callback
      })
    } else {
      ztoolkit.Shortcut.register("event", {
        id: config.addonRef,
        modifiers: "control",
        key: "/",
        callback: callback
      })
    }
    
    document.addEventListener(
      "keydown",
      async (event: any) => {
        if ((event.metaKey || event.ctrlKey) && event.key?.toLowerCase() == "c") {
          const selectedText = this.getSelectedOutputText()
          if (selectedText.length && this.copyTextToClipboard(selectedText)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
        if (
          (event.shiftKey && event.key.toLowerCase() == "?") ||
          (event.key == "/" && Zotero.isMac)) {
          if (
            event.originalTarget.isContentEditable ||
            "value" in event.originalTarget
          ) {
            return;
          }
          
        }
      },
      true
    );
  }
}
