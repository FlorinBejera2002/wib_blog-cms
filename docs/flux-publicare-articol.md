# Flux Publicare Articol — Strapi CMS + Symfony

## 1. Mediul de Dezvoltare (local)

```
Tu (admin) → Strapi Admin Panel (localhost:1337/admin)
                     ↓
              Scrii/editezi articolul
                     ↓
              Apeși "Publish"
                     ↓
              Articolul e disponibil via REST API
                     ↓
         Symfony (localhost) → GET /api/blog-posts?...
                     ↓
              Afișează pe /blog-cms/{system}/{slug}
```

---

## 2. Mediul de Producție

Pentru producție, ai nevoie de **două componente** pe server:

### A. Strapi CMS (backend headless)

- Rulează ca un **serviciu Node.js** pe server (de ex. pe portul 1337)
- Folosește **PostgreSQL** în loc de SQLite (configurat în `config/env/production/database.js`)
- Accesibil doar intern sau pe un subdomeniu (de ex. `cms.asigurari.ro`)
- **Nu e public** — doar admin-ul și Symfony-ul comunică cu el

### B. Symfony (frontend-ul existent)

- `BlogApiClient.php` face request-uri HTTP la Strapi
- Cache-ul (5 min posturi, 30 min categorii) reduce încărcarea
- Webhook-ul invalidează cache-ul instant la publicare

---

## 3. Fluxul complet: Articol nou → Live pe site

```
1. SCRII ARTICOLUL
   ├── Intri în Strapi Admin (cms.asigurari.ro/admin)
   ├── Content Manager → Blog Posts → Create new entry
   ├── Completezi: titlu, slug, conținut, categorie, tags
   ├── Uploadezi imaginea featured
   └── Status: Draft (nu e vizibil pe site)

2. REVIEW (opțional)
   ├── Apeși "Submit for Review" → status: pending_review
   ├── Un alt admin aprobă → status: approved
   └── (Poți sări acest pas și publica direct)

3. PUBLICI
   ├── Apeși "Publish" în Strapi
   ├── Strapi setează publishedAt = now
   ├── Lifecycle hook trimite webhook la Symfony:
   │     POST /cms-webhook/invalidate
   │     Body: { "model": "blog-post", "entry": { "slug": "..." } }
   └── Symfony invalidează cache-ul pentru acel post

4. LIVE PE SITE
   ├── Următorul vizitator care accesează pagina:
   │     GET asigurari.ro/blog-cms/rca/articol-nou
   ├── BlogCmsController → BlogApiClient → Strapi API
   ├── Strapi returnează articolul (publishedAt != null)
   ├── BlogPostDTO parsează JSON-ul
   ├── Twig template renderizează HTML
   └── Articolul e vizibil! Cache-ul se reface pentru 5 min.
```

---

## 4. Deploy pe producție — pașii concreți

### Pas 1: Pregătire Strapi pentru producție

Fișierele de configurare existente:

- `Dockerfile` — containerizare
- `docker-compose.yml` — Strapi + PostgreSQL
- `nginx/strapi.conf` — reverse proxy
- `config/env/production/` — config producție (server.js, database.js)

### Pas 2: Pe server

```bash
# 1. Clonezi repo-ul wib-cms pe server
git clone ... /opt/wib-cms

# 2. Configurezi .env cu secretele de producție
cp .env.example .env
nano .env  # setezi DATABASE_*, JWT_SECRET, APP_KEYS, etc.

# 3. Pornești cu Docker
docker-compose up -d

# 4. Sau fără Docker:
npm install
NODE_ENV=production npm run build
NODE_ENV=production npm start
```

### Pas 3: Configurare Symfony

În `parameters.yml` pe producție:

```yaml
cms_base_url: 'http://localhost:1337'   # sau http://cms.asigurari.ro
cms_api_token: 'token-ul-de-read'
cms_api_token_write: 'token-ul-de-write'
cms_webhook_secret: 'secret-partajat'
```

### Pas 4: Migrare date

```bash
# Exporti datele din dev (SQLite) și le importi în producție (PostgreSQL)
# Sau rulezi din nou scripturile de migrare pe server:
node scripts/migrate.js
node scripts/set-image-urls.js
node scripts/import-all-missing.js
```

### Pas 5: Switch rutele

Când ești mulțumit, redirecționezi `/blog/` spre controller-ul CMS în `routing.yml`.

---

## 5. Diagrama arhitecturii

```
┌─────────────────────────────────────────────────┐
│                    SERVER                        │
│                                                  │
│  ┌──────────────┐     ┌───────────────────────┐ │
│  │  Strapi CMS  │◄────│  Admin (tu, browser)  │ │
│  │  :1337       │     └───────────────────────┘ │
│  │  PostgreSQL  │                                │
│  └──────┬───────┘                                │
│         │ REST API                               │
│         ▼                                        │
│  ┌──────────────┐     ┌───────────────────────┐ │
│  │   Symfony    │◄────│  Vizitator (browser)  │ │
│  │   :80/443    │     └───────────────────────┘ │
│  │   + Cache    │                                │
│  └──────────────┘                                │
│                                                  │
│  Imagini: /bundles/main/images/asigurari/blog/   │
│  (servite direct de Nginx/Apache)                │
└─────────────────────────────────────────────────┘
```

---

## 6. Fișiere cheie

| Fișier | Rol |
|--------|-----|
| `wib-cms/src/api/blog-post/content-types/blog-post/schema.json` | Schema articolului în Strapi |
| `wib-cms/src/api/blog-post/controllers/blog-post.js` | Controller custom (review flow) |
| `wib-cms/src/api/blog-post/lifecycles.js` | Webhook la publicare |
| `src/MainBundle/CMS/Client/BlogApiClient.php` | Client API Symfony → Strapi |
| `src/MainBundle/CMS/DTO/BlogPostDTO.php` | Mapare JSON → PHP object |
| `src/MainBundle/Controller/BlogCmsController.php` | Controller Symfony pentru blog CMS |
| `src/MainBundle/Resources/views/common/asigurari/blog_cms/article.html.twig` | Template articol |
| `src/MainBundle/Resources/views/common/asigurari/blog_cms/_partials/article_card.html.twig` | Card articol în listing |

---

## 7. Strategia pentru imagini

Imaginile blog-ului sunt gestionate în **două moduri paralele**:

1. **`featuredImageUrl`** (câmp text în Strapi) — stochează calea Symfony asset (ex: `/bundles/main/images/asigurari/blog/rca/masina-la-service.webp`). Imaginea e servită direct de web server-ul Symfony.

2. **`featuredImage`** (relație media în Strapi) — imaginea e și în Strapi Media Library, pentru gestionare din admin panel.

Template-urile Twig prioritizează `featuredImageUrl`, cu fallback pe `featuredImage`:

```twig
{% if post.featuredImageUrl %}
    <img src="{{ post.featuredImageUrl }}" alt="{{ post.featuredImageAlt }}">
{% elseif post.featuredImage %}
    <img src="{{ post.featuredImage.getUrl(cms_base_url) }}" alt="{{ post.featuredImageAlt }}">
{% endif %}
```

---

## 8. Note importante

- **Cache**: Articolele sunt cache-uite 5 minute, categoriile 30 minute. Webhook-ul invalidează instant la publicare.
- **Fallback**: Dacă Strapi e down, Symfony afișează o pagină de eroare gracioasă, nu crash.
- **Rute paralele**: `/blog/` = Twig static (vechi), `/blog-cms/` = Strapi (nou). Ambele funcționează simultan.
- **Fișierele Twig originale** nu au fost șterse — pot fi folosite ca backup.
