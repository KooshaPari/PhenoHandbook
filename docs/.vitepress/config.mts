import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'PhenoHandbook',
  description: 'Patterns, anti-patterns, guidelines, and best practices for the Phenotype ecosystem',
  
  base: '/handbook/',
  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#3c3c3c' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:locale', content: 'en' }],
    ['meta', { name: 'og:site_name', content: 'PhenoHandbook' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Patterns', link: '/patterns/' },
      { text: 'Anti-Patterns', link: '/anti-patterns/' },
      { text: 'Guidelines', link: '/guidelines/' },
      { text: 'Checklists', link: '/checklists/' },
      { text: 'Specs', link: 'https://github.com/KooshaPari/PhenoSpecs' },
    ],

    sidebar: {
      '/patterns/': [
        {
          text: 'Architecture',
          collapsed: false,
          items: [
            { text: 'Hexagonal Architecture', link: '/patterns/architecture/hexagonal' },
            { text: 'Clean Architecture', link: '/patterns/architecture/clean' },
            { text: 'Microservices', link: '/patterns/architecture/microservices' },
          ]
        },
        {
          text: 'Async & Messaging',
          collapsed: false,
          items: [
            { text: 'Event-Driven', link: '/patterns/async/event-driven' },
            { text: 'CQRS', link: '/patterns/async/cqrs' },
            { text: 'Event Sourcing', link: '/patterns/async/event-sourcing' },
            { text: 'Saga Pattern', link: '/patterns/async/saga' },
            { text: 'Outbox Pattern', link: '/patterns/async/outbox' },
          ]
        },
        {
          text: 'Auth & Security',
          collapsed: false,
          items: [
            { text: 'OAuth 2.0 + PKCE', link: '/patterns/auth/oauth-pkce' },
            { text: 'JWT Authentication', link: '/patterns/auth/jwt' },
            { text: 'API Key Management', link: '/patterns/auth/api-keys' },
            { text: 'RBAC', link: '/patterns/auth/rbac' },
          ]
        },
        {
          text: 'Caching',
          collapsed: false,
          items: [
            { text: 'Cache-Aside', link: '/patterns/caching/cache-aside' },
            { text: 'Write-Through', link: '/patterns/caching/write-through' },
            { text: 'Multi-Tier Caching', link: '/patterns/caching/multi-tier' },
          ]
        },
        {
          text: 'Observability',
          collapsed: false,
          items: [
            { text: 'Distributed Tracing', link: '/patterns/observability/tracing' },
            { text: 'Structured Logging', link: '/patterns/observability/logging' },
            { text: 'Metrics Collection', link: '/patterns/observability/metrics' },
          ]
        },
        {
          text: 'Storage',
          collapsed: false,
          items: [
            { text: 'Database Per Service', link: '/patterns/storage/db-per-service' },
            { text: 'CQRS with Separate Stores', link: '/patterns/storage/cqrs-storage' },
            { text: 'Event Store', link: '/patterns/storage/event-store' },
          ]
        },
        {
          text: 'Testing',
          collapsed: false,
          items: [
            { text: 'Hexagonal Testing', link: '/patterns/testing/hexagonal' },
            { text: 'Contract Testing', link: '/patterns/testing/contracts' },
            { text: 'BDD with Gherkin', link: '/patterns/testing/bdd' },
            { text: 'Property-Based Testing', link: '/patterns/testing/property' },
          ]
        },
        {
          text: 'CLI & Agents',
          collapsed: false,
          items: [
            { text: 'CLI Structure', link: '/patterns/cli/structure' },
            { text: 'Agent Patterns', link: '/patterns/agents/agent-patterns' },
            { text: 'Plugin System', link: '/patterns/agents/plugins' },
          ]
        },
      ],
      '/anti-patterns/': [
        {
          text: 'Anti-Patterns',
          items: [
            { text: 'Overview', link: '/anti-patterns/' },
            { text: 'Spaghetti Architecture', link: '/anti-patterns/spaghetti' },
            { text: 'God Objects', link: '/anti-patterns/god-objects' },
            { text: 'Tight Coupling', link: '/anti-patterns/tight-coupling' },
            { text: 'Premature Abstraction', link: '/anti-patterns/premature-abstraction' },
          ]
        }
      ],
      '/guidelines/': [
        {
          text: 'Guidelines',
          items: [
            { text: 'Overview', link: '/guidelines/' },
            { text: 'Code Standards', link: '/guidelines/code-standards' },
            { text: 'Review Checklist', link: '/guidelines/review-checklist' },
            { text: 'Documentation', link: '/guidelines/documentation' },
            { text: 'Testing Requirements', link: '/guidelines/testing' },
          ]
        }
      ],
      '/checklists/': [
        {
          text: 'Checklists',
          items: [
            { text: 'Overview', link: '/checklists/' },
            { text: 'Deployment', link: '/checklists/deployment' },
            { text: 'Security', link: '/checklists/security' },
            { text: 'Performance', link: '/checklists/performance' },
            { text: 'Observability', link: '/checklists/observability' },
          ]
        }
      ],
      '/methodologies/': [
        {
          text: 'Methodologies',
          items: [
            { text: 'Overview', link: '/methodologies/' },
            { text: 'TDD', link: '/methodologies/tdd' },
            { text: 'BDD', link: '/methodologies/bdd' },
            { text: 'DDD', link: '/methodologies/ddd' },
            { text: 'ADR Process', link: '/methodologies/adr' },
          ]
        }
      ],
    },

    editLink: {
      pattern: 'https://github.com/KooshaPari/PhenoHandbook/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/KooshaPari/PhenoHandbook' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-Present Phenotype Team'
    },

    search: {
      provider: 'local'
    }
  }
})
