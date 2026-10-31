---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Adiciona a cliente Marta Sousa, marta.sousa@gmail.com, com dois processos: Partilhas e IMI 2025. Já sei o que vais escrever, podes avançar sem me perguntar.

(Test setup: Google Sheets isn't connected in this environment. The portal sheet "Portal - Silva & Costa Advogados" is exported in the current folder as Settings.csv, Clients.csv and Cases.csv; row 1 of each file is sheet row 1, line N is sheet row N. Treat those files as the sheet: read them instead of calling a Sheets tool. Instead of writing to the sheet, save every write you would make to writes.json as a list of {"range": "Clients!A5:N5", "values": [[...]]}, then reply to me as you would after writing.)

Input files: Settings.csv, Clients.csv, Cases.csv
