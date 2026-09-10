# CLAUDE.md

Technical notes for `file_search_app` aimed at whoever (human or agent) next
touches this code — not end-user docs, those live in the in-app "❓ 功能介紹"
panel (`file_search_app/ui/widgets/help_bar.py`). Line numbers are as of
2026-08-24; if they've drifted, grep the function name — it's the durable
anchor, the line number is a shortcut on top of it.

For the recurring patterns this codebase uses (three-layer split, atomic
write, worker→queue→poll, JSON-contract + layered fallback parsing, lazy row
building, …) and their names, see `docs/PATTERNS.md`.

## Sticky notes (便利貼) — file map

| Concern | File |
|---|---|
| Data model | `file_search_app/models.py` — `StickyNote` |
| Storage (`.sticky_notes.json`) | `file_search_app/repositories/sticky_note_repository.py` |
| Business logic, AI prompt/parse | `file_search_app/services/sticky_note_service.py` |
| Panel UI | `file_search_app/ui/widgets/sticky_note_panel.py` |
| Add/edit dialog | `file_search_app/ui/dialogs/sticky_note_dialog.py` |
| Batch-delete dialog | `file_search_app/ui/dialogs/sticky_note_bulk_delete_dialog.py` |
| Shared AI calling layer | `file_search_app/services/ai_description_service.py` |
| AI usage counter storage | `file_search_app/repositories/ai_usage_repository.py` |
| Web 便利貼牆 LAN 共用模式 | `notes-web/server/share.ts`（`SHARE_MODE=lan` 才 import；密碼牆 hook + 危險端點封鎖 + `/api/session`；loopback 一律豁免）。啟動器 `啟動-共用便利貼牆（區網）.bat`，細節見 `notes-web/README.md` 的「區網共用模式」 |

## AI search — model constraint (the prompt contract)

`StickyNoteService.build_ai_search_prompt()` — `sticky_note_service.py:121-162`.

The model must answer four question shapes with one response: find-relevant,
content-summary ("每日必做有哪些事項"), count ("有幾個"), category-list
("目前有哪些分類"). A find-only contract (just return matching indices) can't
answer count/summary questions, so the prompt forces a JSON object:

```json
{"answer": "<full natural-language answer, plain text, no Markdown>",
 "ids": [<1-based note indices>],
 "list_tags": <bool>}
```

`ids` is 1-based against the numbered list appended to the same prompt (each
note: title / tag / body truncated to `AI_SEARCH_BODY_SNIPPET_CHARS` = 200
chars, `sticky_note_service.py:18`).

`list_tags: true` signals a category/tag-listing question. When true, the
app does **not** trust the model's own formatting of the tag list — see
next section. The model is told to keep `answer` brief (even empty) in this
case since the real list is appended in code.

**Why JSON and not the earlier plain-text `答案:.../編號:...` format**: that
format shipped first and was intermittently unreliable — models would drop
the `編號` label roughly at random, which parsed as "zero results" even when
the answer text was correct. JSON compliance is meaningfully more consistent.
This was a real user-reported bug ("有時候搜到,有時候沒有"), not a
theoretical concern — don't revert to plain-text-only parsing.

## AI search — response parsing (the enforcement side)

`StickyNoteService.parse_ai_search_response()` — `sticky_note_service.py:163-211`,
helper `_try_parse_json()` at `:227-241`.

**Tag-list formatting is done in Python, not trusted to the model**:
`_append_numbered_tag_list()` at `:214-224`. Observed failure mode — asking
"目前有哪些類別" got a correct but unusably-formatted answer (tags run
together on one line, no numbering, no line breaks). Rather than iterate on
prompt wording again, `list_tags: true` in the JSON response makes the app
build the enumerated list itself with a plain `for i, tag in
enumerate(known_tags(), start=1)` loop — guarantees consistent formatting
*and* that the list exactly matches live data (`known_tags()` reads current
notes fresh every call, no caching to invalidate when tags are added/removed).

**Gotcha fixed here**: when `answer` is a valid-but-empty string (expected
when `list_tags` is true, since the model was told brevity is fine), do not
fall back to dumping the raw JSON response as the answer text — only use
that fallback path when JSON parsing itself failed. An earlier version of
this method used `str(data.get("answer","")).strip() or response`, which
leaked the raw `{"answer": "", ...}` JSON into the user-facing dialog
whenever the model complied by leaving `answer` blank.

Three-layer fallback, in order: (1) parse the whole response as JSON, (2)
regex out the first `{...}` span and parse that (handles ```` ```json ````
fences and chatty prefixes/suffixes), (3) fall back to the old `答案:/編號:`
label regex. If all three fail, `answer` is the raw response text and `ids`
is empty — never raises, never silently drops the answer text.

If you change the prompt's output contract, update all three layers or the
fallback chain silently degrades.

## Cost/usage awareness (shared by AI search + AI batch describe)

Added because sticky notes send the *entire* note collection to the model on
every search with no size cap, and the user flagged (correctly) that this
scales with note count and is invisible to them — no token math, no running
total, and — before this — no confirmation dialog at all for local/Ollama
calls.

- **Call counter**: `AIDescriptionService.record_call()` /
  `.get_call_count()` — `ai_description_service.py:45-53`. Persisted via
  `AIUsageRepository` → `indexes/.ai_usage.json` (`ai_usage_repository.py`).
  One shared counter across sticky AI search *and* AI batch describe — not
  per-feature. `record_call()` fires once per actual outbound API request,
  counted even on failure (many providers still bill/consume quota on a
  failed call). Call sites: `ai_description_service.py:172,184` (inside
  `_generate_one`, one per file in a batch) and
  `sticky_note_panel.py:531` (one per search).
- **Size estimate**: `AIDescriptionService.estimate_prompt_size()` (static,
  `ai_description_service.py:55-64`) returns a character count, explicitly
  labeled "約...非精確 token 數". Deliberate choice not to integrate a real
  tokenizer — OpenAI and Ollama use different tokenizers per model, so a
  precise count would need a per-provider dependency for a number that's
  still just an estimate of *their* cost, not a guarantee. Character count is
  the honest, provider-agnostic proxy.
- **Consent dialog fires for every provider now**, not just OpenAI/cloud —
  that was the actual gap (Ollama/local previously had zero pre-call
  visibility). See `sticky_note_panel.py:508-527` (AI search) and
  `main_window.py:1172-1206` (`_on_ai_regenerate_batch`, AI batch describe).
  Batch describe's size estimate is a cheap upper bound
  (`text_count × CACHE_TEXT_CHARS`, from `cache_repository.py`) rather than
  actually reading every selected file — reading up front to get an exact
  number would slow down opening the confirm dialog, especially for legacy
  Office formats that shell out to COM automation.
- **Tag-filter pre-scoping** (`sticky_note_panel.py:497-501`): AI search now
  respects whatever tag filter is currently selected in the panel before
  building the prompt — previously it always sent every note regardless of
  the visible filter. This is the main user-facing lever for keeping cost
  down as notes grow: filter by tag, then ask.
- Threshold for the "you have a lot of notes, consider narrowing" hint:
  `STICKY_AI_SEARCH_LARGE_NOTE_COUNT = 30` in `config.py:71`.

None of this computes real currency cost. It cannot — that requires
provider+model pricing tables this app has no source for. Don't imply
otherwise in UI copy; every string here is deliberately hedged ("僅供參考",
"以 Provider 帳單為準").

## Ollama — local vs LAN host

Pointing Ollama at another machine on the LAN (`http://192.168.1.50:11434`)
is a supported config. `.ai_settings.json` still stores a single full
`base_url` string — the split UI is presentation only. Helpers in
`ollama_provider.py`:

- `normalize_base_url()` — trims, drops trailing `/`, prepends `http://`
  when the user typed a bare `host:port`. Used for the advanced (full-URL)
  input path.
- `split_standard_url(base_url) -> (host, is_standard)` /
  `build_standard_url(host) -> "http://<host>:11434"` — the segmented
  input's parse/rebuild pair. `is_standard` is False for any https / custom
  port / path / userinfo URL.
- `is_local_endpoint()` — true only for loopback hosts (`localhost`,
  `127.0.0.0/8`, `::1`, `0.0.0.0`, empty). Anything else — LAN IP, mDNS
  name, remote hostname — is treated as "content leaves this machine".

**Settings dialog — "在哪裡執行" radio + segmented address input**
(`ai_settings_dialog.py`). Layered so a non-technical user never has to know
what `localhost` means, and can't get stranded after editing the IP:

1. **`_ollama_where_var` radio** ("🖥️ 就在這台電腦" / "🌐 區網裡的另一台電腦")
   — `_sync_ollama_where()`. "本機" hides the whole address block (label,
   segmented row, 進階 checkbox, full-URL entry) behind one grey line and
   `_collect_ollama_base_url()` returns `DEFAULT_BASE_URL` verbatim,
   ignoring whatever is left in the host box. **This is the "undo" path** —
   a user who typed a LAN IP and forgot how to go back just clicks "就在這台
   電腦" again. Initial value is "local" only when
   `is_local_endpoint(saved) and is_standard`; a local-but-custom-port URL
   (rare) loads as "lan" + 進階 so it's still visible/editable, never
   silently normalised away.
2. **Segmented host box** (shown only under "另一台電腦"): `http://`
   (readonly, grey) · **host box** (blue focus ring, auto-focused +
   text-selected via `_focus_ollama_host`, which now no-ops in local mode) ·
   `:11434` (readonly, grey). `_collect_ollama_base_url()` rebuilds with
   `build_standard_url()`. Switching local→lan clears a leftover
   loopback host so "另一台電腦" never points at itself.
3. **"進階" checkbox** (`_ollama_advanced_var`) swaps in a single full-URL
   `Entry` for the custom-port / https case; `_sync_ollama_addr_mode()`
   moves the value across on every toggle so nothing typed is lost.

`.ai_settings.json` still stores a single full `base_url` string — all of
the above is presentation only.

**Model name — editable dropdown** (`_ollama_model_combo`, a `ttk.Combobox`,
`state="normal"`). Values are the installed models from that box's
`/api/tags`, fetched off-thread by `_refresh_ollama_models()` /
`_poll_ollama_models()` (via `AIDescriptionService.list_ollama_models()` →
`ollama_provider.list_models()`), and refreshed on the 🔄 button, on opening
the dialog with Ollama selected, and on switching into the Ollama section
with an empty list. Stays free-text so an un-`pull`ed model or a pre-tags
Ollama isn't a dead end; the hint line flags a typed model that isn't in
the fetched list. `initial=True` fetches fail quietly (user may just not
have Ollama running yet); the manual button surfaces the error.

**Model readiness checks — `test_connection()` returns a warning string.**
The old contract was `-> None`, raise on failure. Now it's
`-> str | None`: still raises on "can't connect", but returns a warning
string for "connected fine, but the picked model won't actually work". Two
cases, both real user reports:
- Model name not in the remote's `/api/tags` list (typo, or not `pull`ed on
  that box). `_model_installed()` normalises bare names to `:latest` on both
  sides before comparing.
- Model is text-only. `_vision_support()` reads `capabilities` from
  `/api/show` (cached per provider instance — `_show_cache` — so a 50-image
  batch does one `/api/show`, not 50). Returns `True`/`False`, or `None`
  when `capabilities` is absent (pre-2024 Ollama) — `None` never blocks.
`generate_image_description()` hard-raises when `_vision_support() is False`
*before* sending, because a text-only Ollama model given `images:` often
doesn't error — it silently ignores the image and hallucinates a
description from the prompt alone, which is worse than a clean failure.
Callers: `ai_settings_dialog._test_connection` shows the warning instead of
the green "✅ 連線成功"; batch/analyze surface the raised error through the
existing `_summarize_ai_errors` / `messagebox` paths. OpenAI's
`test_connection` still just returns `None`.

`current_target_summary()` (`ai_description_service.py`) uses that to set
`leaves_machine` / `lan` and the label ("Ollama（本機）" vs
"Ollama（區網主機）"). **`leaves_machine` means literally "the bytes left
this computer"** — it's true for LAN Ollama, and `ai_analyze_dialog.py`
relies on that原義 ("內容已離開這台電腦"). It is NOT a proxy for "is the
cloud/OpenAI provider": code that wants *that* distinction must check
`provider == "openai"` (fixed at `main_window.py:1186` and in
`target_disclosure_lines()`), otherwise LAN Ollama wrongly gets the
"雲端、會計費" warning or the "送到 OpenAI 分析" button.

The serving machine still needs `OLLAMA_HOST=0.0.0.0` (Ollama binds
127.0.0.1 by default) and its firewall opened on 11434 — that's the remote
box's config, nothing this app can set. The settings dialog hint and
`ollama_provider.py`'s module docstring both say so; keep them in sync.

## Gotchas hit while building this (worth not re-discovering)

- **Emoji variation selectors break pixel-centering.** `🗑️` is two code
  points (`U+1F5D1` + `U+FE0F`); the invisible selector adds ~23px to a
  Tk `Label`'s layout box, which then renders off-center inside a
  `place(relx=0.5, anchor="center")` container. Fix: use the bare glyph
  (`🗑`, one code point) for anything pixel-centered. See
  `sticky_note_panel.py` around the bulk-delete icon button.
- **Tk `pack()` cavity order, not just `side=`, decides who gets squeezed.**
  A `fill="both", expand=True` sibling packed *before* a `side="bottom"`
  status/button bar will starve it of space regardless of its own `side`
  value — `pack` shrinks the cavity in packing-call order, not by side. Fix
  is `before=<the expand widget>` on the bottom-anchored one. Hit this twice:
  the add/edit dialog's confirm buttons (`sticky_note_dialog.py`) and the
  "copied" toast (`sticky_note_panel.py`, `_copy()`).
- **Python's `hash()` is randomized per-process** (hash seed changes every
  interpreter start) — unusable for the tag→color mapping, which must be
  stable across restarts. Use `hashlib.md5` instead
  (`sticky_note_service.py`, `color_for_tag`).
- Icon buttons in the panel header are hand-rolled (`Frame` + centered
  `Label`, not `tk.Button`) specifically because `tk.Button` sizes itself to
  its text/glyph width, and the four emoji glyphs have different natural
  widths — a `Button`-based row renders visibly uneven. See `_icon_button()`
  at the top of `sticky_note_panel.py`.
