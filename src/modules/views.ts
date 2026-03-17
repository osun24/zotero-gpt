import { config } from "../../package.json";
import Meet from "./Meet/api"
import Utils from "./utils";
import { Document } from "langchain/document";
import { help, fontFamily, defaultTags, parseTag } from "./base"
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
  private dotsContainer!: HTMLDivElement;
  private tagsContainer!: HTMLDivElement;
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
    this.dotsContainer?.classList.remove("loading")
    this.setText(`## ${title}\n\n${message}`, true, false)
    new ztoolkit.ProgressWindow(title, { closeOtherProgressWindows: true })
      .createLine({ text: message, type: "default" })
      .show()
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

  private async resolvePlaceholders(text: string) {
    if (/\$\{[\s\S]+?\}/.test(text) || /```j(?:ava)?s(?:cript)?/i.test(text)) {
      throw new Error("Legacy JavaScript tag syntax is no longer supported. Use safe placeholders like {{input}} or {{pdf_selection}}.")
    }
    const placeholders = [...text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)]
    for (const match of placeholders) {
      const rawString = match[0]
      const placeholder = match[1]
      text = text.replace(rawString, await this.resolvePlaceholder(placeholder))
    }
    return text
  }

  /**
   * Generated drag handler
   */
  private addDragEvent(node: HTMLDivElement) {
    let posX: number, posY: number
    let currentX: number, currentY: number
    let isDragging: boolean = false

    function handleMouseDown(event: MouseEvent) {
      // Skip drag logic for input, textarea, and tag elements
      if (
        event.target instanceof window.HTMLInputElement ||
        event.target instanceof window.HTMLTextAreaElement ||
        (event.target as HTMLDivElement).classList.contains("tag")
      ) {
        return
      }
      posX = node.offsetLeft - event.clientX
      posY = node.offsetTop - event.clientY
      isDragging = true
    }

    function handleMouseUp(event: MouseEvent) {
      isDragging = false
    }

    function handleMouseMove(event: MouseEvent) {
      if (isDragging) {
        currentX = event.clientX + posX
        currentY = event.clientY + posY
        node.style.left = currentX + "px"
        node.style.top = currentY + "px"
      }
    }

    // Add event listeners
    node.addEventListener("mousedown", handleMouseDown)
    node.addEventListener("mouseup", handleMouseUp)
    node.addEventListener("mousemove", handleMouseMove)
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
    // Root container
    const container = ztoolkit.UI.createElement(document, "div", {
      id: this.id,
      styles: {
        display: "none",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        position: "fixed",
        width: Zotero.Prefs.get(`${config.addonRef}.width`) as string,
        // height: "4em",
        fontSize: "18px",
        borderRadius: "10px",
        backgroundColor: "#fff",
        boxShadow: `0px 1.8px 7.3px rgba(0, 0, 0, 0.071),
                    0px 6.3px 24.7px rgba(0, 0, 0, 0.112),
                    0px 30px 90px rgba(0, 0, 0, 0.2)`,
        fontFamily: fontFamily,
      }
    })
    this.addDragEvent(container)
    this.bindCtrlScrollZoom(container)
    // Input area
    const inputContainer = this.inputContainer = ztoolkit.UI.appendElement({
      tag: "div",
      id: "input-container",
      styles: {
        borderBottom: "1px solid #f6f6f6",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        flexDirection: "column",
        alignItems: "center",
      },
      children: [
        {
          tag: "input",
          styles: {
            width: "calc(100% - 1.5em)",
            height: "2.5em",
            borderRadius: "10px",
            border: "none",
            outline: "none",
            fontFamily: "Consolas",
            fontSize: ".8em",
          }
        },
        {
          tag: "textarea",
          styles: {
            display: "none",
            width: "calc(100% - 1.5em)",
            maxHeight: "20em",
            minHeight: "2em",
            borderRadius: "10px",
            border: "none",
            outline: "none",
            resize: "vertical",
            marginTop: "0.55em",
            fontFamily: "Consolas",
            fontSize: ".8em"

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
            that.setText("success", true, false)
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
                    Zotero.Prefs.set(`${config.addonRef}.${key}`, value)
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
      styles: {
        width: "calc(100% - 1em)",
        backgroundColor: "rgba(89, 192, 188, .08)",
        color: "#374151",
        maxHeight: document.documentElement.getBoundingClientRect().height * .5 + "px",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "0.25em 0.5em",
        display: "none",
        // resize: "vertical"
      },
      children: [
        {
          tag: "div", // Change this to 'div'
          classList: ["markdown-body"],
          styles: {
            fontSize: "0.8em",
            lineHeight: "2em",
            // margin: ".5em 0"
          },
          properties: {
            // Used for copying plain text
            pureText: ""
          }
        }
      ],
      listeners: [
        {
          type: "dblclick",
          listener: () => {
            const text = outputContainer.querySelector("[pureText]")!.getAttribute("pureText") || ""
            new ztoolkit.Clipboard()
              .addText(text, "text/unicode")
              .copy()
            new ztoolkit.ProgressWindow(config.addonName)
              .createLine({ text: "Copy Plain Text", type: "success" })
              .show()
          }
        }
      ]
    }, container) as HTMLDivElement
    this.bindCtrlScrollZoomOutput(outputContainer)
    // Command tags
    const tagsMore = Zotero.Prefs.get(`${config.addonRef}.tagsMore`) as string
    const tagsContainer = this.tagsContainer = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["tags-container"],
      styles: {
        width: "calc(100% - .5em)",
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-start",
        alignItems: "center",
        margin: ".25em 0",
        flexWrap: tagsMore == "expand" ? "wrap" : "nowrap",
        overflow: "hidden",
        height: "1.7em"
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
    }, container) as HTMLDivElement
    this.dotsContainer = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["three-dots"],
      styles: {
        // width: "100%",
        display: "flex",
        height: "1em",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: "0.25em",
        cursor: "pointer",
        opacity: ".5",
        transition: "opacity .25s linear"
      },
      children: (() => {
          let arr = []
          for (let i = 0; i < 3; i++) {
            arr.push({
              tag: "div",
              classList: ["dot"],
              styles: {
                width: "6px",
                height: "6px",
                margin: "0 .25em",
                backgroundColor: "#ff7675",
                borderRadius: "6px",
              },
            })
          }
          return arr
        })() as any,
      listeners: [
        {
          type: "click",
          listener: () => {
            if (tagsMore == "scroll") { return }
            tagsContainer.style.height = tagsContainer.style.height == "auto" ? "1.7em" : "auto"
          }
        }
      ]
    }, container) as HTMLDivElement
    document.documentElement.append(container)
    this.renderTags()
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
      classList: ["tag"],
      styles: {
        display: "inline-block",
        flexShrink: "0",
        fontSize: "0.8em",
        height: "1.5em",
        color: `rgba(${red}, ${green}, ${blue}, 1)`,
        backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.15)`,
        borderRadius: "1em",
        border: "1px solid #fff",
        margin: ".25em",
        padding: "0 .8em",
        cursor: "pointer",
        whiteSpace: "nowrap"
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
    Meet.Global.input = this.inputContainer.querySelector("input")?.value as string
    this._tag = tag
    const popunWin = new ztoolkit.ProgressWindow(tag.tag, { closeTime: -1, closeOtherProgressWindows: true })
      .show()
    Meet.Global.popupWin = popunWin
    popunWin
      .createLine({ text: "Generating input content...", type: "default" })
    this.dotsContainer?.classList.add("loading")
    this.outputContainer.style.display = "none"
    ztoolkit.log(tag, this.getTags())
    const tagIndex = this.getTags().map(JSON.stringify).indexOf(JSON.stringify(tag)) as number
    this.rippleEffect(
      this.container.querySelector(`#tag-${tagIndex}`)!,
      tag.color
    )
    const outputDiv = this.outputContainer.querySelector("div")!
    outputDiv.innerHTML = ""
    outputDiv.setAttribute("pureText", "");
    let text = tag.text.replace(/^#.+\n/, "")
    try {
      text = await this.resolvePlaceholders(text)
    } catch (error: any) {
      popunWin.createLine({ text: error.message, type: "fail" })
      popunWin.startCloseTimer(3000)
      this.showError("Unsafe Tag Blocked", error.message)
      return
    }
    popunWin.createLine({ text: `Characters ${text.length}`, type: "success" })
    popunWin.createLine({ text: "Answering...", type: "default" })
    text = await Meet.OpenAI.getGPTResponse(text) as string
    this.dotsContainer?.classList.remove("loading")
    if (text.trim().length) {
      popunWin.createLine({ text: "Done", type: "success" })
    } else {
      popunWin.createLine({ text: "Done", type: "fail" })
    }
    popunWin.startCloseTimer(3000)
  }

  /**
   * Execute the current input text
   */
  private async execText(text: string) {
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
    this.outputContainer.style.display = "none"
    const outputDiv = this.outputContainer.querySelector("div")!
    outputDiv.innerHTML = ""
    outputDiv.setAttribute("pureText", "");
    if (text.trim().length == 0) { return }
    this.dotsContainer?.classList.add("loading")
    await Meet.OpenAI.getGPTResponse(text)
    this.dotsContainer?.classList.remove("loading")
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
    for (let defaultTag of defaultTags) {
      if (!tags.find((tag: Tag) => tag.tag == defaultTag.tag)) {
        tags.push(defaultTag)
      }
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
    this.container.setAttribute("follow", "")
    if (x + y < 0) {
      const rect = document.documentElement.getBoundingClientRect()
      x = rect.width / 2 - this.container.offsetWidth / 2;
      y = rect.height / 2 - this.container.offsetHeight / 2;
    }

    // ensure container doesn't go off the right side of the screen
    if (x + this.container.offsetWidth > window.innerWidth) {
      x = window.innerWidth - this.container.offsetWidth
    }

    // ensure container doesn't go off the bottom of the screen
    if (y + this.container.offsetHeight > window.innerHeight) {
      y = window.innerHeight - this.container.offsetHeight
    }

    // ensure container doesn't go off the left side of the screen
    if (x < 0) {
      x = 0
    }

    // ensure container doesn't go off the top of the screen
    if (y < 0) {
      y = 0
    }
    // this.container.style.display = "flex"
    this.container.style.left = `${x}px`
    this.container.style.top = `${y}px`
    // reBuild && (this.container.style.display = "flex")
  }

  /**
   * Hide the UI and clear all active intervals
   */
  public hide() {
    this.container.style.display = "none"
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
      }
    }, this.outputContainer)
    docs.forEach((doc: Document, index: number) => {
      ztoolkit.UI.appendElement({
        namespace: "html",
        tag: "a",
        styles: {
          margin: ".3em",
          fontSize: "0.8em",
          cursor: "pointer",
          borderRadius: "3px",
          backgroundColor: "rgba(89, 192, 188, .43)",
          width: "1.5em",
          height: "1.5em",
          textAlign: "center",
          color: "white",
          fontWeight: "bold"
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
      }, auxDiv)
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
    document.querySelector(".gpt-menu-box")?.remove()
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
        border: "1px solid #d4d4d4",
        backgroundColor: "#ffffff",
        borderRadius: "8px",
        boxShadow: `0px 1px 2px rgba(0, 0, 0, 0.028),
                                0px 3.4px 6.7px rgba(0, 0, 0, .042),
                                0px 15px 30px rgba(0, 0, 0, .07)`,
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
              padding: "4px 8px",
              cursor: "default",
              fontSize: "13px",
              borderRadius: "4px",
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
                  nodes.forEach(e => e.classList.remove("selected"))
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
                borderTop: ".5px solid #e0e0e0",
                borderBottom: ".5px solid #e0e0e0",
              }
            })
          }

        }
        return arr
      })() as any
    }, document.documentElement)
    
    const winRect = document.documentElement.getBoundingClientRect()
    const nodeRect = menuNode.getBoundingClientRect()
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
      nodes.forEach(e => e.classList.remove("selected"))
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
