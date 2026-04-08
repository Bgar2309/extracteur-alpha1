# extracteur-alpha1

Outil d'extraction de bons de livraison Prozon via l'API Claude (Anthropic), avec matching automatique des références EHS et génération de sortie Odoo.

## Stack

- **Next.js 14** (Pages Router)
- **Anthropic Claude API** — extraction PDF par IA
- **PDF.js** — visualiseur PDF côté client

## Déploiement sur Vercel

### Prérequis

> **Plan Vercel Pro requis** : l'API accepte des PDF jusqu'à 20 Mo (base64), ce qui dépasse la limite de 4,5 Mo du plan Hobby. La durée des appels Claude peut également dépasser le timeout de 10 s du plan Hobby.

### Étapes

1. Importer le dépôt dans [vercel.com/new](https://vercel.com/new).
2. Vercel détecte automatiquement Next.js — aucun réglage de build à modifier.
3. Dans **Settings → Environment Variables**, ajouter :

   | Variable           | Valeur                          |
   |--------------------|---------------------------------|
   | `ANTHROPIC_API_KEY` | Votre clé API Anthropic (`sk-ant-api03-…`) |

4. Déployer.

### Configuration incluse (`vercel.json`)

| Paramètre      | Valeur |
|----------------|--------|
| `maxDuration`  | 60 s   |
| `memory`       | 1024 MB |

Ces valeurs s'appliquent à la fonction `/api/extract`.

## Développement local

```bash
cp .env.local.example .env.local
# Renseigner ANTHROPIC_API_KEY dans .env.local

npm install
npm run dev
```

L'application est disponible sur [http://localhost:3000](http://localhost:3000).
