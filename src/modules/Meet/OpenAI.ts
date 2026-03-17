import { config } from "../../../package.json";
import { MD5 } from "crypto-js"
import { Document } from "langchain/document";
import LocalStorage from "../localStorage";
import Views from "../views";
import Meet from "./api";

const similarity = require("compute-cosine-similarity");

const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000
const CHAT_REQUEST_TIMEOUT_MS = 300_000
const CHAT_STREAM_STALL_TIMEOUT_MS = 20_000

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
  Meet.debug("openai:similaritySearch:start", {
    queryLength: queryText.length,
    docCount: docs.length,
    key: obj.key
  })
  const storage = Meet.Global.storage = Meet.Global.storage || new LocalStorage(config.addonRef)
  await storage.lock.promise;
  const embeddings = new OpenAIEmbeddings() as any
  const id = MD5(docs.map((i: any) => i.pageContent).join("\n\n")).toString()
  const _vv = storage.get(obj, id)
  ztoolkit.log(_vv)
  let vv: any
  if (_vv) {
    Meet.progress({ text: "Reading embeddings...", type: "default" })
    vv = _vv
  } else {
    Meet.progress({ text: "Generating embeddings...", type: "default" })
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
  Meet.progress({ text: `Searching ${relatedNumber} related content...`, type: "default" })
  const k = relatedNumber * 5
  const pp = vv.map((v: any) => similarity(v0, v));
  docs = [...pp].sort((a, b) => b - a).slice(0, k).map((p: number) => {
    return docs[pp.indexOf(p)]
  })
  const result = docs.sort((a, b) => b.pageContent.length - a.pageContent.length).slice(0, relatedNumber)
  Meet.debug("openai:similaritySearch:done", {
    resultCount: result.length,
    relatedNumber
  })
  return result
}

class OpenAIEmbeddings {
  private async request(input: string[]) {
    const views = Zotero.ZoteroGPT.views as Views
    const api = getConfiguredApiBase()
    const secretKey = Zotero.Prefs.get(`${config.addonRef}.secretKey`)
    const splitLen = Number(Zotero.Prefs.get(`${config.addonRef}.embeddingBatchNum`) || 10)
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
            timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
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
  Meet.debug("openai:getGPTResponse:start", { requestLength: requestText.length })
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
  Meet.debug("openai:getGPTResponseByOpenAI:start", {
    requestLength: requestText.length,
    model,
    api,
    chatNumber: Zotero.Prefs.get(`${config.addonRef}.chatNumber`)
  })
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
  const id: number = window.setInterval(() => {
    if (responseText === undefined && _textArr.length == textArr.length) { return }
    _textArr = textArr.slice(0, _textArr.length + 1)
    let text = _textArr.join("")
    text.length > 0 && views.setText(text)
    if (responseText !== undefined && responseText == text) {
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
    Meet.debug("openai:chat:request:start", {
      url,
      requestLength: requestText.length,
      messageCount: views.messages.slice(-chatNumber).length
    })
    await Zotero.HTTP.request(
      "POST",
      url,
      {
        timeout: CHAT_REQUEST_TIMEOUT_MS,
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
          Meet.debug("openai:chat:requestObserver", { timeout: CHAT_REQUEST_TIMEOUT_MS })
          xmlhttp.timeout = CHAT_REQUEST_TIMEOUT_MS
          let stallTimer: number | undefined
          let progressEvents = 0
          const clearStallTimer = () => {
            if (stallTimer !== undefined) {
              window.clearTimeout(stallTimer)
              stallTimer = undefined
            }
          }
          const resetStallTimer = () => {
            clearStallTimer()
            stallTimer = window.setTimeout(() => {
              try {
                xmlhttp.abort()
              } catch {}
            }, CHAT_STREAM_STALL_TIMEOUT_MS)
          }
          xmlhttp.addEventListener("loadend", clearStallTimer, { once: true })
          xmlhttp.addEventListener("abort", clearStallTimer, { once: true })
          xmlhttp.addEventListener("error", clearStallTimer, { once: true })
          xmlhttp.addEventListener("timeout", clearStallTimer, { once: true })
          resetStallTimer()
          xmlhttp.onprogress = (e: any) => {
            resetStallTimer()
            try {
              const chunks = e.target.response.match(/data: (.+)/g) || []
              textArr = chunks.filter((s: string) => s.indexOf("content") >= 0).map((s: string) => {
                try {
                  return JSON.parse(s.replace("data: ", "")).choices[0].delta.content.replace(/\n+/g, "\n")
                } catch {
                  return false
                }
              }).filter(Boolean)
              progressEvents += 1
              if (progressEvents <= 5) {
                Meet.debug("openai:chat:onprogress", {
                  progressEvents,
                  responseLength: e.target.response?.length || 0,
                  chunkCount: textArr.length
                })
              }
            } catch {
              ztoolkit.log(e.target.response)
            }
          };
        },
      }
    );
    Meet.debug("openai:chat:request:done", {
      responseLength: textArr.join("").length,
      chunkCount: textArr.length
    })
  } catch (error: any) {
    Meet.debug("openai:chat:request:error", {
      message: error?.message,
      stack: error?.stack
    })
    try {
      error = JSON.parse(error?.xmlhttp?.response).error
      textArr = [`# ${error.code}\n> ${url}\n\n**${error.type}**\n${error.message}`]
      new ztoolkit.ProgressWindow(error.code, { closeOtherProgressWindows: true })
        .createLine({ text: error.message, type: "default" })
        .show()
    } catch {
      const message = /abort/i.test(error?.message || "")
        ? "The response stream stalled and was aborted before completion."
        : (error?.message || "The request did not complete.")
      textArr = [`## Request Failed\n\n${message}`]
      new ztoolkit.ProgressWindow("Error", { closeOtherProgressWindows: true })
        .createLine({ text: message, type: "default" })
        .show()
    }
  }
  responseText = textArr.join("")
  if (!responseText.trim()) {
    responseText = "## Empty Response\n\nThe configured API endpoint finished without returning any assistant text."
  }
  Meet.debug("openai:getGPTResponseByOpenAI:done", {
    responseLength: responseText.length
  })
  views.messages.push({
    role: "assistant",
    content: responseText
  })
  return responseText
}
