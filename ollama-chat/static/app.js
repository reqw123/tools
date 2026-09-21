const $ = (id) => document.getElementById(id)

const messagesEl = $('messages')
const inputEl = $('input')
const sendBtn = $('sendBtn')
const stopBtn = $('stopBtn')
const modelSelect = $('modelSelect')
const settingsBtn = $('settingsBtn')
const settingsPanel = $('settingsPanel')
const newChatBtn = $('newChatBtn')
const systemPromptEl = $('systemPrompt')
const temperatureEl = $('temperature')
const temperatureValEl = $('temperatureVal')
const ollamaStatusEl = $('ollamaStatus')
const testConnBtn = $('testConnBtn')
const attachmentsEl = $('attachments')
const imageInput = $('imageInput')
const docInput = $('docInput')

const LS_HISTORY = 'ollama-chat-history'
const LS_MODEL = 'ollama-chat-model'
const LS_SYSTEM = 'ollama-chat-system'
const LS_TEMP = 'ollama-chat-temp'

/** history：純文字紀錄，用來重新整理後還原畫面。images 只留張數不留 base64
 *  （localStorage 容量有限，圖片重整後本來就沒必要重送）。*/
let history = []
let models = []
let pendingImages = [] // {name, dataUrl, base64}
let pendingDocs = [] // {filename, text, truncated}
let currentAbort = null

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_HISTORY)
    if (raw) history = JSON.parse(raw)
  } catch {
    history = []
  }
  systemPromptEl.value = localStorage.getItem(LS_SYSTEM) || ''
  const t = parseFloat(localStorage.getItem(LS_TEMP) || '0.7')
  temperatureEl.value = String(t)
  temperatureValEl.textContent = t.toFixed(1)
}

function persistHistory() {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(history))
  } catch {
    /* 存不下（配額滿了）就算了，不影響當下對話 */
  }
}

function renderMarkdown(text) {
  try {
    const html = marked.parse(text || '')
    return DOMPurify.sanitize(html)
  } catch {
    return (text || '').replace(/</g, '&lt;')
  }
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function bubbleFor(msg) {
  const wrap = document.createElement('div')
  wrap.className = `msg ${msg.role}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  if (msg.imageCount) {
    const note = document.createElement('div')
    note.className = 'msg-meta'
    note.textContent = `🖼️ 附加了 ${msg.imageCount} 張圖片`
    wrap.appendChild(note)
  }
  bubble.innerHTML = renderMarkdown(msg.content)
  wrap.appendChild(bubble)
  return wrap
}

function renderAll() {
  messagesEl.innerHTML = ''
  for (const m of history) messagesEl.appendChild(bubbleFor(m))
  scrollToBottom()
}

function addSystemNote(text) {
  const wrap = document.createElement('div')
  wrap.className = 'msg system'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = text
  wrap.appendChild(bubble)
  messagesEl.appendChild(wrap)
  scrollToBottom()
}

function setStatus(text, kind) {
  ollamaStatusEl.textContent = text
  ollamaStatusEl.classList.remove('ok', 'err')
  if (kind) ollamaStatusEl.classList.add(kind)
}

async function loadModels(manual = false) {
  const savedModel = localStorage.getItem(LS_MODEL)
  if (manual) {
    testConnBtn.disabled = true
    setStatus('測試中…', null)
  }
  try {
    const r = await fetch('api/models')
    const data = await r.json()
    if (data.error) {
      setStatus(`❌ ${data.error}`, 'err')
      return
    }
    models = data.models || []
    modelSelect.innerHTML = ''
    if (models.length === 0) {
      setStatus('⚠️ 連線成功，但這台 Ollama 沒有任何已安裝的模型（ollama pull 一個再重新整理）', 'err')
      return
    }
    for (const m of models) {
      const opt = document.createElement('option')
      opt.value = m.name
      opt.textContent = m.vision ? `${m.name} 👁` : m.name
      modelSelect.appendChild(opt)
    }
    if (savedModel && models.some((m) => m.name === savedModel)) {
      modelSelect.value = savedModel
    }
    setStatus(`✅ 連線成功，共 ${models.length} 個模型`, 'ok')
    updateVisionWarning()
  } catch (e) {
    setStatus(`❌ 讀取模型清單失敗：${e.message}`, 'err')
  } finally {
    testConnBtn.disabled = false
  }
}

testConnBtn.onclick = () => loadModels(true)

function currentModelVision() {
  const m = models.find((x) => x.name === modelSelect.value)
  return m ? m.vision : null
}

function updateVisionWarning() {
  const vision = currentModelVision()
  const warnChip = document.getElementById('visionWarnChip')
  if (warnChip) warnChip.remove()
  if (pendingImages.length > 0 && vision === false) {
    const chip = document.createElement('span')
    chip.id = 'visionWarnChip'
    chip.className = 'chip warn'
    chip.textContent = `⚠️ ${modelSelect.value} 不支援看圖，圖片會被忽略`
    attachmentsEl.appendChild(chip)
  }
}

function renderAttachments() {
  attachmentsEl.innerHTML = ''
  attachmentsEl.classList.toggle('hidden', pendingImages.length === 0 && pendingDocs.length === 0)
  pendingImages.forEach((img, i) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.innerHTML = `<img src="${img.dataUrl}" alt="" />`
    const name = document.createElement('span')
    name.textContent = img.name
    chip.appendChild(name)
    const rm = document.createElement('button')
    rm.className = 'chip-remove'
    rm.textContent = '✕'
    rm.onclick = () => {
      pendingImages.splice(i, 1)
      renderAttachments()
    }
    chip.appendChild(rm)
    attachmentsEl.appendChild(chip)
  })
  pendingDocs.forEach((doc, i) => {
    const chip = document.createElement('span')
    chip.className = 'chip'
    const label = document.createElement('span')
    label.textContent = `📄 ${doc.filename}${doc.truncated ? '（已截斷）' : ''}`
    chip.appendChild(label)
    const rm = document.createElement('button')
    rm.className = 'chip-remove'
    rm.textContent = '✕'
    rm.onclick = () => {
      pendingDocs.splice(i, 1)
      renderAttachments()
    }
    chip.appendChild(rm)
    attachmentsEl.appendChild(chip)
  })
  updateVisionWarning()
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

imageInput.addEventListener('change', async () => {
  for (const file of Array.from(imageInput.files || [])) {
    const dataUrl = await fileToDataUrl(file)
    const base64 = dataUrl.split(',')[1] || ''
    pendingImages.push({ name: file.name, dataUrl, base64 })
  }
  imageInput.value = ''
  renderAttachments()
})

docInput.addEventListener('change', async () => {
  for (const file of Array.from(docInput.files || [])) {
    const fd = new FormData()
    fd.append('file', file)
    addSystemNote(`讀取「${file.name}」中…`)
    try {
      const r = await fetch('api/extract', { method: 'POST', body: fd })
      const data = await r.json()
      if (data.error) {
        addSystemNote(`❌ ${file.name}：${data.error}`)
        continue
      }
      pendingDocs.push({ filename: data.filename, text: data.text, truncated: data.truncated })
      // pdf/docx 除了抽文字，伺服器還會回幾張版面/嵌入圖（見 server.py 的
      // _pdf_page_images/_docx_images）——併進 pendingImages，跟手動貼圖走
      // 同一套「模型不支援看圖就警告/不送出」判斷（updateVisionWarning）。
      const imgs = data.images || []
      imgs.forEach((base64, i) => {
        pendingImages.push({
          name: `${file.name}（第 ${i + 1}/${data.images_total} 頁）`,
          dataUrl: `data:image/jpeg;base64,${base64}`,
          base64,
        })
      })
      if (imgs.length > 0 && imgs.length < data.images_total) {
        addSystemNote(`「${file.name}」共 ${data.images_total} 頁/張圖，只附加了前 ${imgs.length} 張`)
      }
    } catch (e) {
      addSystemNote(`❌ ${file.name}：${e.message}`)
    }
  }
  docInput.value = ''
  renderAttachments()
})

$('attachImageBtn').onclick = () => imageInput.click()
$('attachDocBtn').onclick = () => docInput.click()

settingsBtn.onclick = () => settingsPanel.classList.toggle('hidden')
temperatureEl.oninput = () => {
  temperatureValEl.textContent = parseFloat(temperatureEl.value).toFixed(1)
  localStorage.setItem(LS_TEMP, temperatureEl.value)
}
systemPromptEl.oninput = () => localStorage.setItem(LS_SYSTEM, systemPromptEl.value)
modelSelect.onchange = () => {
  localStorage.setItem(LS_MODEL, modelSelect.value)
  updateVisionWarning()
}

newChatBtn.onclick = () => {
  if (history.length && !confirm('清空目前對話？（不會影響已安裝的模型或 Ollama 設定）')) return
  history = []
  pendingImages = []
  pendingDocs = []
  persistHistory()
  renderAll()
  renderAttachments()
}

function autoResize() {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px'
}
inputEl.addEventListener('input', autoResize)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
})
sendBtn.onclick = send
stopBtn.onclick = () => currentAbort?.abort()

function buildOutgoingContent() {
  let content = inputEl.value.trim()
  for (const doc of pendingDocs) {
    const note = doc.truncated ? '（內容過長，已截斷）' : ''
    content += `\n\n[附加文件：${doc.filename}${note}]\n${doc.text}`
  }
  return content.trim()
}

async function send() {
  const content = buildOutgoingContent()
  if (!content || sendBtn.disabled) return
  if (!modelSelect.value) {
    addSystemNote('⚠️ 沒有可用的模型，先確認 Ollama 有裝模型')
    return
  }

  const vision = currentModelVision()
  const useImages = vision !== false ? pendingImages : []
  if (pendingImages.length > 0 && vision === false) {
    addSystemNote(`⚠️ ${modelSelect.value} 不支援看圖，這則訊息的圖片不會送出`)
  }

  const userMsg = { role: 'user', content, imageCount: useImages.length }
  history.push(userMsg)
  messagesEl.appendChild(bubbleFor(userMsg))
  scrollToBottom()

  const apiMessages = []
  const sys = systemPromptEl.value.trim()
  if (sys) apiMessages.push({ role: 'system', content: sys })
  for (const m of history) {
    if (m.role === 'user' && m === userMsg && useImages.length) {
      apiMessages.push({ role: 'user', content: m.content, images: useImages.map((i) => i.base64) })
    } else {
      apiMessages.push({ role: m.role, content: m.content })
    }
  }

  inputEl.value = ''
  autoResize()
  pendingImages = []
  pendingDocs = []
  renderAttachments()
  persistHistory()

  const assistantWrap = document.createElement('div')
  assistantWrap.className = 'msg assistant'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>'
  assistantWrap.appendChild(bubble)
  messagesEl.appendChild(assistantWrap)
  scrollToBottom()

  sendBtn.classList.add('hidden')
  stopBtn.classList.remove('hidden')
  currentAbort = new AbortController()

  let acc = ''
  let gotAny = false
  try {
    const resp = await fetch('api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        messages: apiMessages,
        temperature: parseFloat(temperatureEl.value),
      }),
      signal: currentAbort.signal,
    })
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop()
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const evt = JSON.parse(line.slice(6))
        if (evt.error) {
          acc += `\n\n❌ ${evt.error}`
          bubble.innerHTML = renderMarkdown(acc)
          gotAny = true
          scrollToBottom()
          continue
        }
        if (evt.content) {
          acc += evt.content
          gotAny = true
          bubble.innerHTML = renderMarkdown(acc)
          scrollToBottom()
        }
        if (evt.done && evt.truncated) {
          acc += '\n\n⚠️ 回應在這裡被截斷了——超過目前的對話上下文長度（附加的文件/圖片或對話太長）。可以「新對話」重開，或附加短一點的內容。'
          bubble.innerHTML = renderMarkdown(acc)
          scrollToBottom()
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      acc += `\n\n❌ ${e.message}`
      bubble.innerHTML = renderMarkdown(acc)
    } else if (!gotAny) {
      acc = '（已停止）'
      bubble.innerHTML = renderMarkdown(acc)
    }
  } finally {
    sendBtn.classList.remove('hidden')
    stopBtn.classList.add('hidden')
    currentAbort = null
  }

  history.push({ role: 'assistant', content: acc })
  persistHistory()
}

loadPersisted()
renderAll()
renderAttachments()
loadModels()
