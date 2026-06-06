# تكاملات MCP + Zapier + HF

## ما تم تفعيله في Cursor MCP

| المصدر | الأدوات |
|--------|---------|
| **Zambahola Local** | `zambahola_get_telemetry` · `get_analyst` · `queue_command` |
| **Zapier → GitHub** | issues · PR · create/update file |
| **Zapier → Gmail/Outlook** | إيميل تنبيهات |
| **Zapier → Slack** | رسائل قناة |
| **Zapier → Google Sheets** | سجل metrics |
| **Zapier → MCP Client** | ربط MCP إضافي |
| **Hugging Face** | papers · models · docs |

## تثبيت إضافات Marketplace

راجع: `docs/ar/تثبيت-اضافات-السوق.md` أو شغّل:

```powershell
.\scripts\install-cursor-marketplace.ps1
```

## خطوة واحدة — فعّل Auth

في Cursor Desktop:
1. **Settings → Tools & MCP**
2. اضغط **Connect** على Zapier — فعّل: Sheets · Slack · GitHub
3. تأكد `zambahola-local` يعمل (بعد `install-local-stack.ps1`)

## سيناريوهات جاهزة

### 1) تنبيه Slack عند directional ≥ 58%
Zapier Zap: `LOCAL-TELEMETRY.json` (GitHub new commit) → Slack message

### 2) سجل Google Sheets
كل `push-telemetry` → صف: timestamp · dir_hit · abstain · regime

### 3) Cloud Agent يقرأ جهازك
```powershell
npm run agent:push-telemetry
```
ثم في السحابة: `git pull` → افتح `LOCAL-TELEMETRY.json`

## أبحاث Hugging Face

```powershell
npm run agent:import-hf-research
```

مراجع: DeepLOB · TLOB · order flow CNN — في `hf-research-import.json`

## روابط

- ربط محلي: `docs/ar/ربط-الجهاز-المحلي.md`
- إنجليزي: `docs/INTEGRATIONS.md`
