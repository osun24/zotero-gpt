import { config } from "../../package.json";

const help = `
### Quick Commands

\`/help\` Show all commands.
\`/clear\` Clear history conversation.
\`/report\` Show the current API endpoint, masked key, model, and temperature.
\`/secretKey sk-xxx\` Set GPT secret key. Stored in Zotero preferences, not the OS keychain.
\`/api https://api.openai.com\` Set the OpenAI-compatible API endpoint.
\`/model gpt-4/gpt-3.5-turbo\` Set GPT model. For example, \`/model gpt-3.5-turbo\`.
\`/temperature 1.0\` Set GPT temperature. Controls randomness within a range of 0 to 1.
\`/chatNumber 3\` Set the number of saved historical conversations.
\`/relatedNumber 5\` Set the number of related passages used by AskPDF-style prompts.
\`/deltaTime 100\` Control GPT smoothness (ms).
\`/width 32%\` Control GPT UI width (pct).
\`/tagsMore expand/scroll\` Set mode to display more tags.

### About Tags

Tags are prompt templates with safe placeholders only. JavaScript in tags is not supported.

Supported placeholders:
\`{{input}}\`
\`{{pdf_selection}}\`
\`{{clipboard}}\`
\`{{selected_item_json}}\`
\`{{selected_item_field:abstractNote}}\`
\`{{pdf_annotations}}\`
\`{{selected_pdf_annotations}}\`
\`{{related_text}}\`

### About Output Text

You can \`double click\` on this text to copy GPT's answer.
You can \`long press\` me without releasing, then move me to a suitable position before releasing.

### About Input Text

You can exit me by pressing \`Esc\` above my head and wake me up by pressing \`Shift + /\` or \`Shift + ?\` in the Zotero main window.
You can type the question in my header, then press \`Enter\` to ask me.
You can press \`Ctrl + Enter\` to execute last executed command tag again.
You can press \`Shift + Enter\` to enter long text editing mode and press \`Ctrl + R\` to execute long text.
`

const fontFamily = `Söhne,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif,Helvetica Neue,Arial,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji`

function parseTag(text: string) {
  text = text.replace(/^\n/, "").replace(/\n$/, "")
  let tagString = text.match(/^#(.+)\n/) as any
  function randomColor() {
    var letters = "0123456789ABCDEF";
    var color = "#";
    for (var i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }
  let tag: Tag = {
    tag: config.addonName,
    color: randomColor(),
    position: 9,
    text: text,
    trigger: "",
  }
  if (tagString) {
    tagString = tagString[0]
    tag.tag = tagString.match(/^#([^\[\n]+)/)[1]
    let color = tagString.match(/\[c(?:olor)?="?(#.+?)"?\]/)
    tag.color = color?.[1] || tag.color
    let position = tagString.match(/\[pos(?:ition)?="?(\d+?)"?\]/)
    tag.position = Number(position?.[1] || tag.position)
    let trigger = tagString.match(/\[tr(?:igger)?="?(.+)"?\]/)
    tag.trigger = trigger?.[1] || tag.trigger
    tag.text = `#${tag.tag}[position=${tag.position}][color=${tag.color}][trigger=${tag.trigger}]` + "\n" + text.replace(/^#.+\n/, "")
  }
  return tag
}

let defaultTags: any = [
`
#🪐AskPDF[color=#0EA293][position=10][trigger=/(paper|article|this paper)/i]
You are a helpful assistant. Context information is below.

{{related_text}}

Using the provided context information, write a comprehensive reply to the given query. Make sure to cite results using [number] notation after the reference. If the provided context information refer to multiple subjects with the same name, write separate answers for each subject. Use prior knowledge only if the given context didn't provide enough information.

Answer the question: {{input}}
`,
`
#🌟Translate[c=#D14D72][pos=11][trigger=/^translate/i]
Translate the following content to Simplified Chinese:

User input:
{{input}}

PDF selection:
{{pdf_selection}}
`,
`
#✨Improve writing[color=#8e44ad][pos=12][trigger=/^(improve|polish)/i]
Below is text from an academic paper. Polish the writing to meet academic style, improve spelling, grammar, clarity, concision, and readability. When necessary, rewrite the sentence. List all modifications and explain the reasons in a markdown table.

User input:
{{input}}

Selected text:
{{pdf_selection}}
`,
`
#Clipboard[c=#576CBC][pos=13][trigger=/(clipboard|copied content)/i]
This is the content in my clipboard:

{{clipboard}}

My request:
{{input}}
`,
`
#Annotations[c=#F49D1A][pos=14][trigger=/(selected )?(annotations?|highlights?)/i]
Selected PDF annotations:

{{selected_pdf_annotations}}

All PDF annotations:

{{pdf_annotations}}

Please answer me in the language of my question. Make sure to cite results using [number] notation after the reference.
My question is: {{input}}
`,
`
#Selection[c=#D14D72][pos=15][trigger=/(selected text|this text|selected passage)/i]
Read these contents:

{{pdf_selection}}

Answer me in the language of my question. This is my question: {{input}}
`,
`
#Item[c=#159895][pos=16][trigger=/(this paper|this article|this item)/i]
This is a Zotero item presented in JSON format:

{{selected_item_json}}

Based on this item, answer: {{input}}
`,
`
#Items[c=#159895][pos=17][trigger=/(these papers|these articles|these items)/i]
These are Zotero items related to the current question:

{{related_text}}

Please answer me using the same language as my question. Make sure to cite results using [number] notation after the reference.
My question is: {{input}}
`,
]
defaultTags = defaultTags.map(parseTag)

export { help, fontFamily, defaultTags, parseTag }
