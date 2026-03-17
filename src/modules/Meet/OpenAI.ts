import { config } from "../../../package.json";
import { MD5 } from "crypto-js"
import { Document } from "langchain/document";
import LocalStorage from "../localStorage";
import Views from "../views";
import Meet from "./api";

const similarity = require("compute-cosine-similarity");

function showMissingSecretKeyError(context: string) {
  const title = "Missing API Key"
  const message = `Your secretKey is not configured. ${context}`
  const views = Zotero.ZoteroGPT.views as Views
  views?.setText(`## ${title}\n\n${message}`, true, false)
  new ztoolkit.ProgressWindow(title, { closeOtherProgressWindows: true })
    .createLine({ text: message, type: "default" })
    .show()
}

function getConfiguredApiBase() {
  let api = Zotero.Prefs.get(`${config.addonRef}.api`) as string
  return api.replace(/\/(?:v1)?\/?$/, "")
}

/**
 * Given a query and candidate documents, return the most similar documents.
 */
export async function similaritySearch(queryText: string, docs: Document[], obj: { key: string }) {
  const storage = Meet.Global.storage = Meet.Global.storage || new LocalStorage(config.addonRef)
  await storage.lock.promise;
  const embeddings = new OpenAIEmbeddings() as any
  const id = MD5(docs.map((i: any) => i.pageContent).join("\n\n")).toString()
  await storage.lock
  const _vv = storage.get(obj, id)
  ztoolkit.log(_vv)
  let vv: any
  if (_vv) {
    Meet.Global.popupWin.createLine({ text: "Reading embeddings...", type: "default" })
    vv = _vv
  } else {
    Meet.Global.popupWin.createLine({ text: "Generating embeddings...", type: "default" })
    vv = await embeddings.embedDocuments(docs.map((i: any) => i.pageContent))
    if (!vv) {
      return []
    }
    window.setTimeout(async () => {
      await storage.set(obj, id, vv)
    })
  }

  const v0 = await embeddings.embedQuery(queryText)
  if (!v0) {
    return []
  }
  const relatedNumber = Zotero.Prefs.get(`${config.addonRef}.relatedNumber`) as number
  Meet.Global.popupWin.createLine({ text: `Searching ${relatedNumber} related content...`, type: "default" })
  const k = relatedNumber * 5
  const pp = vv.map((v: any) => similarity(v0, v));
  docs = [...pp].sort((a, b) => b - a).slice(0, k).map((p: number) => {
    return docs[pp.indexOf(p)]
  })
  return docs.sort((a, b) => b.pageContent.length - a.pageContent.length).slice(0, relatedNumber)
}

class OpenAIEmbeddings {
  private async request(input: string[]) {
    const views = Zotero.ZoteroGPT.views as Views
    const api = getConfiguredApiBase()
    const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
    const splitLen = Zotero.Prefs.get(`${config.addonRef}.embeddingBatchNum`)
    const url = `${api}/v1/embeddings`

    if (!secretKey) {
      showMissingSecretKeyError("Embeddings will only be requested from your configured API endpoint.")
      return
    }

    let finalEmbeddings: any[] = []
    for (let i = 0; i < input.length; i += splitLen) {
      const chunk = input.slice(i, i + splitLen)
      ztoolkit.log("input", chunk)
      try {
        const res = await Zotero.HTTP.request(
          "POST",
          url,
          {
            responseType: "json",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${secretKey}`,
            },
            body: JSON.stringify({
              model: "text-embedding-ada-002",
              input: chunk,
            }),
          }
        )
        if (res?.response?.data) {
          finalEmbeddings = finalEmbeddings.concat(res.response.data.map((i: any) => i.embedding))
        }
      } catch (error: any) {
        try {
          error = error.xmlhttp.response?.error
          views.setText(`# ${error.code}\n> ${url}\n\n**${error.type}**\n${error.message}`, true)
          new ztoolkit.ProgressWindow(error.code, { closeOtherProgressWindows: true })
            .createLine({ text: error.message, type: "default" })
            .show()
        } catch {
          new ztoolkit.ProgressWindow("Error", { closeOtherProgressWindows: true })
            .createLine({ text: error.message, type: "default" })
            .show()
        }
        return
      }
    }
    return finalEmbeddings
  }

  public async embedDocuments(texts: string[]) {
    return await this.request(texts)
  }

  public async embedQuery(text: string) {
    return (await this.request([text]))?.[0]
  }
}

export async function getGPTResponse(requestText: string) {
  const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
  if (!secretKey) {
    showMissingSecretKeyError("Requests are never sent to third-party fallback endpoints.")
    return ""
  }
  return await getGPTResponseByOpenAI(requestText)
}

/**
 * Send a chat completion request to the configured OpenAI-compatible endpoint.
 */
export async function getGPTResponseByOpenAI(requestText: string) {
  const views = Zotero.ZoteroGPT.views as Views
  const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
  const temperature = Zotero.Prefs.get(`${config.addonRef}.temperature`)
  const api = getConfiguredApiBase()
  const model = Zotero.Prefs.get(`${config.addonRef}.model`)
  views.messages.push({
    role: "user",
    content: requestText
  })
  const deltaTime = Zotero.Prefs.get(`${config.addonRef}.deltaTime`) as number
  let _textArr: string[] = []
  let textArr: string[] = []
  views.stopAlloutput()
  views.setText("")
  let responseText: string | undefined
  const id: number = window.setInterval(async () => {
    if (!responseText && _textArr.length == textArr.length) { return}
    _textArr = textArr.slice(0, _textArr.length + 1)
    let text = _textArr.join("")
    text.length > 0 && views.setText(text)
    if (responseText && responseText == text) {
      views.setText(text, true)
      window.clearInterval(id)
    }
  }, deltaTime)
  views._ids.push({
    type: "output",
    id: id
  })
  const chatNumber = Zotero.Prefs.get(`${config.addonRef}.chatNumber`) as number
  const url = `${api}/v1/chat/completions`
  try {
    await Zotero.HTTP.request(
      "POST",
      url,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: views.messages.slice(-chatNumber),
          stream: true,
          temperature: Number(temperature)
        }),
        responseType: "text",
        requestObserver: (xmlhttp: XMLHttpRequest) => {
          xmlhttp.onprogress = (e: any) => {
            try {
              textArr = e.target.response.match(/data: (.+)/g).filter((s: string) => s.indexOf("content") >= 0).map((s: string) => {
                try {
                  return JSON.parse(s.replace("data: ", "")).choices[0].delta.content.replace(/\n+/g, "\n")
                } catch {
                  return false
                }
              }).filter(Boolean)
            } catch {
              ztoolkit.log(e.target.response)
            }
            if (e.target.timeout) {
              e.target.timeout = 0;
            }
          };
        },
      }
    );
  } catch (error: any) {
    try {
      error = JSON.parse(error?.xmlhttp?.response).error
      textArr = [`# ${error.code}\n> ${url}\n\n**${error.type}**\n${error.message}`]
      new ztoolkit.ProgressWindow(error.code, { closeOtherProgressWindows: true })
        .createLine({ text: error.message, type: "default" })
        .show()
    } catch {
      new ztoolkit.ProgressWindow("Error", { closeOtherProgressWindows: true })
        .createLine({ text: error.message, type: "default" })
        .show()
    }
  }
  responseText = textArr.join("")
  ztoolkit.log("responseText", responseText)
  views.messages.push({
    role: "assistant",
    content: responseText
  })
  return responseText
}
