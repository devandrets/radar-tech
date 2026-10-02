# 🎯 Radar Tech - Radar de Vagas Inteligente

Ferramenta CLI em Node.js para varredura e curadoria cirúrgica de vagas tech (LinkedIn, Gupy, Programathor e Remotar), eliminando automaticamente vagas inúteis (banco de talentos, modelo híbrido fora da região, vagas júnior/sênior incompatíveis e stacks fora do foco).

---

## ⚡ Como Rodar

Entre na pasta do projeto:

```bash
cd radar-tech
```

### 1. Varredura com Termos Customizados (JSON)
```bash
# Roda o termo padrão configurado no search-terms.json
npm run scan

# Varre TODOS os termos do search-terms.json de uma só vez (com deduplicação de vagas)
npm run scan:all

# Lista todos os termos configurados no JSON
npm run terms
# ou: node cli.js --list-terms

# Roda um termo específico do search-terms.json por índice ou nome
node cli.js --term=2
node cli.js --term="Fastify"
```

### 2. Varreduras Específicas Pré-definidas (Sempre nas últimas 24h)
```bash
# Busca vagas de Fastify nas últimas 24h
npm run scan:fastify

# Busca Backend TypeScript Junior nas últimas 24h
npm run scan:ts

# Busca geral de Node.js Junior nas últimas 24h
npm run scan:node
```

### 3. Varredura com Parâmetros Customizados & Exportação (LinkedIn)
```bash
# Busca vagas das últimas 24h (padrão) e exporta relatório em markdown para candidaturas/
node cli.js --export

# Busca filtrando vagas que exigem inglês fluente falado/calls diárias
node cli.js --filter-english --export

# Varre todos os termos do JSON das últimas 24h e exporta um relatório consolidado
node cli.js --all --export
```

---

## 🚀 Radar Gupy (portal.gupy.io)

O projeto também conta com suporte oficial à **Gupy**, utilizando o endpoint público oficial de busca da plataforma com dados em JSON puro, sem scraping de HTML e com cálculo exato de data (< 24h).

```bash
# Varre o termo padrão da Gupy nas últimas 24h
npm run scan:gupy

# Varre TODOS os termos otimizados de gupy-search-terms.json nas últimas 24h
npm run scan:gupy:all

# Varreduras diretas por tecnologia
npm run scan:gupy:node
npm run scan:gupy:backend

# Lista os termos configurados para a Gupy
npm run terms:gupy

# Varre e exporta relatório detalhado em Markdown em candidaturas/
node gupy-cli.js --all --export

# Busca vagas da última semana (7 dias) ou último mês (30 dias)
node gupy-cli.js --all --days=7 --export
node gupy-cli.js --all --days=30 --export
```

---

## ⚡ Radar ProgramaThor (programathor.com.br)

Varredura focada no maior portal de vagas de tecnologia do Brasil, consumindo as rotas nativas de tecnologia (`/jobs-node-js`, `/jobs-typescript`, etc.) e validando dados precisos de publicação (`datePosted` via JSON-LD):

```bash
# Varre o termo padrão no ProgramaThor nas últimas 24h
npm run scan:programathor

# Varre TODOS os termos de programathor-search-terms.json nas últimas 24h
npm run scan:programathor:all

# Varreduras diretas por tecnologia
npm run scan:programathor:node
npm run scan:programathor:backend

# Lista os termos configurados para o ProgramaThor
npm run terms:programathor

# Varre todos os termos e exporta relatório detalhado em Markdown em candidaturas/
node programathor-cli.js --all --export

# Busca vagas da última semana (7 dias) ou último mês (30 dias)
node programathor-cli.js --all --days=7 --export
node programathor-cli.js --all --days=30 --export
```

---

## 🔁 Relatório geral

```bash
npm run report:all                 # 4 fontes, últimas 24h
npm run report:all -- --days=7     # depois de dia(s) sem rodar: recupera a semana
```

> Termos de senioridade (`sênior`, `sr`, `especialista`, `principal`, `staff`, `tech lead`) só eliminam a vaga quando aparecem **no título**.

## 📁 Customização via Arquivos JSON

Agora você pode customizar o radar sem precisar mexer no código do script:

### 1. 🚫 `company-blacklist.json` (Empresas Banidas)
Adicione qualquer empresa, consultoria ou fábrica de software que você **não** queira ver nos resultados. Vagas dessas empresas são eliminadas sumariamente:

```json
[
  "Crossover",
  "BairesDev",
  "Turing",
  "Stefanini",
  "Wipro",
  "Tata Consultancy Services"
]
```

### 1.1 ✅ `company-allowlist.json` (Nunca Banir Automaticamente)
Empresas aqui **nunca** entram na blacklist automática por ter publicado vaga em inglês. A vaga em inglês continua descartada, mas as vagas em português da empresa passam. Teste iniciado em 2026-10-01 com Onfly e consultorias (Stefanini, CI&T, Capgemini, FCamara). Se até 15/10 não aparecer nada útil delas, voltam para a blacklist.

### 2. ⛔ `terms-blacklist.json` (Termos e Stacks Proibidas)
Configure termos, tecnologias indesejadas, senioridades incompatíveis ou modelos de trabalho que você deseja descartar sumariamente:

```json
[
  "php",
  "laravel",
  "wordpress",
  "c#",
  ".net",
  "asp.net",
  "ruby on rails",
  "estágio",
  "estagiário",
  "trainee",
  "banco de talentos",
  "presencial",
  "híbrido"
]
```

### 3. 🔍 `search-terms.json` (Termos de Busca Monitorados)
Configure seus termos de busca e cargos favoritos. O primeiro termo é o padrão quando você roda `npm run scan`, e o comando `npm run scan:all` varre a lista inteira:

```json
[
  "Node.js Junior",
  "Node.js Jr",
  "Desenvolvedor Node.js Junior",
  "Backend Node Junior",
  "Node.js Pleno",
  "Desenvolvedor Node.js Pleno",
  "Backend Node Pleno",
  "Backend TypeScript Junior",
  "Backend TypeScript Pleno",
  "Desenvolvedor Backend Junior",
  "Desenvolvedor Backend Pleno",
  "Fastify",
  "NestJS"
]
```

### 4. 🏙️ `allowed-cities.json` (Cidades Permitidas)
Configure as cidades da sua região metropolitana ou de interesse. Vagas nessas localidades são aceitas mesmo se forem presenciais ou híbridas. Vagas fora dessas cidades só são aceitas se mencionarem expressamente regime **remoto** na descrição ou no título:

```json
[
  "Belo Horizonte",
  "Betim",
  "Contagem",
  "Florestal",
  "Igarapé",
  "Juiz de Fora",
  "Mateus Leme",
  "Nova Lima"
]
```

---

## ⚙️ Customização Avançada das Regras (`rules.config.js`)

O arquivo [rules.config.js](rules.config.js) centraliza regras avançadas e pesos:

1. **`dealBreakers` (Eliminação Sumária):**
   - `FAKE_REMOTE`: descarta vagas com termos como "presencial", "híbrido", "dias no escritório", etc.
   - `BANCO_TALENTOS`: descarta "banco de talentos", "future opportunities", etc.
   - `STACK_INDESEJADA`: descarta vagas com foco em PHP, .NET, C#, Ruby, etc.
   - `SENIORIDADE_JUNIOR_ESTAGIO`: descarta vagas com "Júnior", "Jr", "Estágio" no título.
2. **`scoring` (Pesos & Match):**
   - **Core (20 pts):** Node, TypeScript, Fastify, NestJS, Express.
   - **Cloud/DevOps (15 pts):** AWS, Docker, Microservices, Clean Arch.
   - **Dados/Mensageria (10 pts):** Kafka, RabbitMQ, PostgreSQL, Redis, MongoDB.
   - **Boosters (5 pts):** Zod, Nx, Prisma, CI/CD, Go.

---

## 🛡️ Risco Zero de Banimento

Esta ferramenta consome os **endpoints públicos de Guest Jobs do LinkedIn**.
- Não necessita de login, e-mail, senha ou cookie de sessão.
- Respeita intervalos e jitter entre requisições.
- Sua conta pessoal do LinkedIn permanece 100% segura e desvinculada do scraper.
