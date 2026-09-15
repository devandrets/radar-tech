export default {
  // Parâmetros padrão de busca no LinkedIn
  searchDefaults: {
    keywords: 'Node.js',
    location: 'Brasil',
    remoteOnly: true, // Ativado f_WT=2 nativo para garantir a tag 'Remote' oficial do LinkedIn
    timeFilter: 'past-24h', // 'past-24h' (r86400), 'past-week' (r604800), 'past-month' (r2592000), 'all'
    limit: 25 // Quantidade padrão de vagas a avaliar por execução
  },

  // Deal-breakers: termos que eliminam a vaga imediatamente (Hard Disqualifiers)
  dealBreakers: [
    {
      id: 'FAKE_REMOTE',
      label: 'Híbrido camuflado / Presencial obrigatório',
      regex: /(?:modelo\s+h[íi]brido|h[íi]brido\b|regime\s+h[íi]brido|\bpresencial\b|dias\s+presenciais|dias\s+no\s+escrit[óo]rio|\b\d\s*x\s*(?:na\s+semana|por\s+semana)\s+no\s+escrit[óo]rio|comparecer\s+ao\s+escrit[óo]rio|atuar\s+h[íi]brido|disponibilidade\s+para\s+presencial|residentes\s+d?e?\s+(?:s[ãa]o\s+paulo|sp|curitiba|rio\s+de\s+janeiro|porto\s+alegre)|morar\s+em\s+(?:s[ãa]o\s+paulo|sp))/i
    },
    {
      id: 'BANCO_TALENTOS',
      label: 'Banco de talentos / Vaga fantasma',
      regex: /(?:banco\s+de\s+talentos|cadastro\s+de\s+reserva|futuras\s+oportunidades|talent\s+pool|future\s+opportunities|oportunidade\s+futura|cadastre\s+seu\s+curr[íi]culo)/i
    },
    {
      id: 'STACK_INDESEJADA',
      label: 'Stack fora do foco backend Node (PHP/.NET/Ruby/WordPress)',
      regex: /(?:\bwordpress\b|\bphp\b|\blaravel\b|\bc#\b|\b\.net\b|\basp\.net\b|\bruby\s+on\s+rails\b|\broils\b)/i
    },
    {
      id: 'EXCLUSIVO_FRONT_OU_MOBILE',
      label: 'Papel exclusivo Front-end ou Mobile',
      regex: /(?:desenvolvedor\s+front[-\s]?end|frontend\s+developer|desenvolvedor\s+mobile|flutter\s+developer|react\s+native\s+developer|ios\s+developer|android\s+developer)/i
    },
    {
      id: 'SENIORIDADE_ESTAGIO_TRAINEE',
      label: 'Senioridade incompatível (Estágio / Trainee)',
      regex: /(?:\best[áa]gio\b|\bestagi[áa]rio\b|\btrainee\b)/i,
      onlyTitle: true
    },
    {
      id: 'VAGA_AFIRMATIVA',
      label: 'Vaga afirmativa ou exclusiva (Mulheres / PCD / Diversidade)',
      regex: /(?:\[pcd\]|\(pcd\)|\bpcd\b.*?\bexclusiv|\bexclusiv[ao].*?\bpcd\b|vaga\s+(?:afirmativa|exclusiva)\b|afirmativa\s+(?:para\s+)?(?:mulheres|pcd|pret[ao]s|negr[ao]s|lgbt|diversidade|pessoas?\s+com\s+defici[êe]ncia)|exclusiv[ao]\s+(?:para\s+|a\s+)?(?:mulheres|pcd|pret[ao]s|negr[ao]s|lgbt|diversidade|pessoas?\s+com\s+defici[êe]ncia)|destinad[ao]\s+exclusivamente\s+a|apenas\s+(?:para\s+)?(?:pcd|mulheres|pessoas?\s+com\s+defici[êe]ncia)|banco\s+de\s+talentos\s+afirmativo)/i
    }
  ],

  // Filtro de localidade e exigência de trabalho remoto
  locationFilter: {
    // Cidades da sua região onde a vaga é aceita mesmo presencial/híbrida
    localCities: [
      'betim',
      'contagem',
      'belo horizonte',
      'igarapé',
      'igarape',
      'juiz de fora',
      'florestal',
      'mateus leme',
      'nova lima'
    ],
    // Lista geral de suporte
    allowedLocations: [
      'brasil',
      'brazil',
      'betim',
      'contagem',
      'belo horizonte',
      'igarapé',
      'igarape',
      'juiz de fora',
      'florestal',
      'mateus leme',
      'nova lima'
    ],
    requireRemoteMention: true,
    remoteRegex: /\b(?:remot[oa]s?|remote|home[\s-]?office|teletrabalho|qualquer\s+lugar\s+do\s+brasil|trabalho\s+[aà]\s+dist[âa]ncia)\b/i
  },

  // Nota: Vagas cuja descrição esteja em inglês são automaticamente descartadas
  // e suas respectivas empresas são adicionadas a company-blacklist.json.

  // Se true, descarta vagas offshore/internacionais que cobram conversação avançada (C1/C2/Fluent English)
  filterOutFluentEnglishCalls: false, // Pode ser ativado via flag CLI ou alterado aqui
  fluentEnglishRegex: /(?:c1|c2|fluent\s+english\s+required|must\s+speak\s+fluent\s+english|daily\s+calls\s+with\s+(?:us|clients)|advanced\s+or\s+fluent\s+english\s+for\s+meetings)/i,

  // Blacklist de empresas / consultorias para ignorar totalmente
  companyBlacklist: [
    // Adicione nomes em lowercase aqui para pular automaticamente
    // 'empresa-x', 'consultoria-y'
  ],

  // Sistema de Pontuação (Score de 0 a 100)
  scoring: {
    minScoreToDisplay: 30, // Pontuação mínima para exibir como oportunidade válida
    hotScoreThreshold: 65, // Pontuação para considerar "Vaga Quente / Alta Prioridade"

    weights: {
      // Core Stack (Peso Alto: 20 pts cada)
      core: {
        points: 20,
        keywords: [
          'node', 'nodejs', 'node.js',
          'typescript',
          'fastify',
          'nestjs', 'nest.js',
          'express', 'expressjs'
        ]
      },
      // Cloud, DevOps & Arquitetura (15 pts cada)
      cloudAndArchitecture: {
        points: 15,
        keywords: [
          'aws', 'amazon web services',
          'lambda', 'sqs', 'sns', 'dynamodb', 's3',
          'microsserviços', 'microservices',
          'docker', 'docker-compose',
          'clean architecture', 'hexagonal architecture'
        ]
      },
      // Mensageria, Bancos & Cache (10 pts cada)
      dataAndMessaging: {
        points: 10,
        keywords: [
          'kafka', 'apache kafka',
          'rabbitmq',
          'postgresql', 'postgres',
          'mongodb',
          'redis',
          'event-driven', 'orientada a eventos'
        ]
      },
      // Diferenciais & Ferramentas Modernas (5 pts cada)
      boosters: {
        points: 5,
        keywords: [
          'nx', 'monorepo',
          'zod',
          'prisma',
          'vitest', 'jest', 'tdd',
          'ci/cd', 'github actions',
          'golang', 'go'
        ]
      }
    }
  }
};
