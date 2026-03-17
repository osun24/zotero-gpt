<div align="center">
  <img src="imgs/background.png" width="50%" />

# Zotero GPT

Use an OpenAI-compatible model inside Zotero to ask questions about papers, PDFs, selections, and annotations.

[![Latest release](https://img.shields.io/github/v/release/MuiseDestiny/zotero-gpt)](https://github.com/MuiseDestiny/zotero-gpt/releases)
[![License](https://img.shields.io/github/license/MuiseDestiny/zotero-gpt)](https://github.com/MuiseDestiny/zotero-gpt/blob/master/LICENSE)
</div>

## What This Plugin Does

Zotero GPT adds a small chat and prompt window to Zotero. You can use it to:

- ask questions about the PDF you are reading
- ask questions about selected items in your library
- work from highlighted text or annotations
- save reusable prompt tags for common tasks
- stream answers directly inside Zotero

This plugin does not include its own AI service. You connect it to your own OpenAI-compatible API endpoint and use your own API key.

## Before You Start

You need:

- Zotero
- an API key for an OpenAI-compatible model provider
- an API endpoint URL, such as `https://api.openai.com`

## Install

### Option 1: Download a Release

1. Download the latest `.xpi` file from the project releases page.
2. Open Zotero.
3. Go to `Tools > Add-ons`.
4. Click the gear icon.
5. Choose `Install Add-on From File`.
6. Select the `.xpi` file.

### Option 2: Build It Yourself

```bash
git clone https://github.com/MuiseDestiny/zotero-gpt.git
cd zotero-gpt
npm install
npm run build
```

After building, install the generated `.xpi` file in Zotero using the same steps above.

## First-Time Setup

1. Open Zotero GPT inside Zotero.
2. Set your API key:

```text
/secretKey sk-...
```

3. If needed, set a custom API endpoint:

```text
/api https://api.openai.com
```

4. Optionally choose a model:

```text
/model gpt-4
```

## Basic Usage

### Open the Window

Open Zotero GPT with the plugin shortcut in Zotero. Once open:

- press `Enter` to send a question
- press `Shift + Enter` to switch to multiline input
- press `Esc` to close or clear the current input

### Ask About a PDF

Open a PDF in Zotero, select some text if needed, then ask a question in the Zotero GPT window.

Examples:

- `Summarize this paper`
- `What is the main method?`
- `Explain this paragraph in simpler language`

### Ask About Library Items

Select one or more items in your Zotero library and ask a question such as:

- `What do these papers have in common?`
- `Which of these papers is about reinforcement learning?`
- `Summarize the selected item`

## Prompt Tags

Prompt tags are saved templates for tasks you use often.

You can:

- create a tag by typing a line that starts with `#`
- save it with `Ctrl + S`
- run it with `Ctrl + R`
- long-press a tag to edit it
- right-long-click a tag to delete it

Tags can also have triggers, so a tag runs automatically when your input matches a word or regular expression.

Example trigger styles:

- plain text: `translate`
- regex: `/^translate/i`

## Safe Placeholders

Tags can insert Zotero data using safe placeholders.

Supported placeholders:

- `{{input}}`
- `{{pdf_selection}}`
- `{{clipboard}}`
- `{{selected_item_json}}`
- `{{selected_item_field:abstractNote}}`
- `{{pdf_annotations}}`
- `{{selected_pdf_annotations}}`
- `{{related_text}}`

Example tag:

```text
#AskPDF[position=10][color=#0EA293][trigger=/(paper|article|this paper)/i]
You are a helpful assistant. Context information is below.

{{related_text}}

Answer the question: {{input}}
```

If a tag contains an unknown placeholder, the plugin stops and shows an error.

Old JavaScript-style tag syntax such as `${...}` is not supported.

## Built-In Commands

You can type these commands directly into the input box:

- `/help` shows available commands
- `/clear` clears chat history
- `/report` shows current settings
- `/secretKey sk-xxx` sets your API key
- `/api https://api.openai.com` sets the API endpoint
- `/model gpt-4` sets the model name
- `/temperature 1.0` sets the sampling temperature
- `/chatNumber 3` sets how many previous messages are kept
- `/relatedNumber 5` sets how many related passages are used
- `/deltaTime 100` controls streaming speed in milliseconds
- `/width 32%` changes the window width
- `/tagsMore expand` changes tag display mode

## Privacy and Security

This plugin is safer than earlier versions, but you should still understand what it sends.

- Requests are sent only to the API endpoint you configure.
- There are no built-in third-party fallback chat services.
- Model output is displayed as text and is not executed as code.
- Tag templates use safe placeholders only.
- Your API key is stored in Zotero preferences, not in your operating system keychain.

Important:

- If you use `{{clipboard}}`, your clipboard text is sent to your configured AI endpoint.
- If you use `{{selected_item_json}}`, item metadata is sent to your configured AI endpoint.
- If you use `{{related_text}}`, extracted paper content is sent to your configured AI endpoint.

Only use an API provider you trust.

## Troubleshooting

### Nothing happens when I ask a question

Check that you have set:

- `/secretKey`
- `/api` if you are not using the default endpoint
- `/model` if your provider requires a specific model name

### I see an error about placeholders

Make sure your tag uses only the supported `{{...}}` placeholders listed above.

### My old tags stopped working

Older JavaScript-based tags were intentionally removed for safety. Rewrite them using safe placeholders.

## Current Limitations

- This plugin does not use the OS keychain for API key storage.
- Legacy programmable tags are no longer supported.
- Some older example tag files in the repository may need updating if you are using them manually.
