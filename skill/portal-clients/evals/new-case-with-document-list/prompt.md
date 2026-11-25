---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Abre um processo novo para o Bruno Mendes: "Compra de casa – Rua Augusta". Preciso que ele me envie:

Bruno:
- Cartão de cidadão
- Declaração de IRS 2025 (se tiver)
- Recibos de vencimento, os últimos 3 meses

Banco:
1. Simulação do crédito
2. Carta de aprovação

+ Certidão permanente do imóvel

Podes avançar sem me perguntar.

(Test setup: Google Sheets isn't connected in this environment. The portal sheet "Portal - Silva & Costa Advogados" is exported in the current folder as Settings.csv, Clients.csv, Cases.csv and Checklist.csv; row 1 of each file is sheet row 1, line N is sheet row N. Treat those files as the sheet: read them instead of calling a Sheets tool. Instead of writing to the sheet, save every write you would make to writes.json as a list of {"range": "Checklist!A4:K4", "values": [[...]]}, then reply to me as you would after writing.)

Input files: Settings.csv, Clients.csv, Cases.csv, Checklist.csv
