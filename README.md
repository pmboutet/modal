# Modal

A collective idea emergence and specification system with AI-driven chat and challenge management.

## 🎯 Purpose

Modal enables collective idea generation through AI-driven conversations. Users interact with an AI chatbot that asks questions, and responses feed into a system that generates structured challenges with pains, gains, and KPI estimations.

## 🏗️ System Architecture

### Core Components

- **Chat Interface** (1/3 screen): Handles user interactions with text, audio, image, and document support
- **Challenge Management** (2/3 screen): Displays and allows editing of generated challenges
- **AI Agent Controller**: Internal multi-model orchestration with prompt management and logging

### Data Flow

1. Administrators configurent les prompts et les modèles via `/admin/ai`
2. Un utilisateur rejoint la session ASK et envoie un message
3. Le message est enregistré dans la base Supabase
4. L'agent IA interne est invoqué (Anthropic/Mistral ou autre) avec gestion de retries et fallback
5. La réponse IA est sauvegardée puis un second agent déclenche la détection d'insights/KPI
6. L'activité est journalisée dans `ai_agent_logs` et les insights sont affichés en temps réel

## 🚀 Features

### Chat System
- ✅ Multi-media support (text, audio, images, documents)
- ✅ Drag & drop file uploads
- ✅ Audio recording capability
- ✅ Real-time message display
- ✅ Time remaining countdown
- ✅ Session closure detection

### Challenge Management
- ✅ Structured challenge display (Pains & Gains)
- ✅ Inline editing of all elements
- ✅ Flexible JSON KPI format
- ✅ Visual highlight on updates
- ✅ Add/remove challenges, pains, gains, KPIs

### API & AI Control
- ✅ RESTful API for operations et configuration des agents
- ✅ Orchestrateur IA interne multi-modèles (Anthropic Sonnet 4.5 optimisé, fallback Mistral)
- ✅ Journalisation détaillée des requêtes/réponses IA
- ✅ Sécurité via clés ASK et gestion de la configuration côté serveur

## 🛠️ ASK Key Format & Troubleshooting

### Valid ASK Key Format
ASK keys must follow these rules:
- **Length**: 3-100 characters
- **Characters**: Only letters, numbers, dots (.), dashes (-), and underscores (_)
- **Content**: Must contain at least one letter or number
- **No spaces or special characters** like @, #, %, etc.

### Examples
✅ **Valid**: `test-key-123`, `user_session_456`, `ASK-2024-001`, `session.id.789`  
❌ **Invalid**: `ab` (too short), `key with spaces`, `key@domain.com`, `---` (no alphanumeric)

### Testing Your ASK Keys
Visit `/test-key` to validate ASK key formats and debug issues:
```
https://your-domain.com/test-key
```

### Common Issues
1. **"Invalid ASK key format"**: Check that your key meets the format requirements above
2. **"No ASK key provided"**: Ensure your URL includes `?key=your-ask-key`
3. **"Error Loading Session"**: Assurez-vous que la configuration IA (modèles, prompts) est valide et que Supabase est accessible

## 📡 API Endpoints

### ASK Management
```
GET    /api/ask/[key]        - Retrieve ASK data
POST   /api/ask/[key]        - Create/update ASK
DELETE /api/ask/[key]        - Close ASK session
```

### Messages
```
GET    /api/messages/[key]   - Get conversation messages
POST   /api/messages/[key]   - Send user message
PUT    /api/messages/[key]   - Add AI response
DELETE /api/messages/[key]   - Clear messages
```

### Challenges
```
GET    /api/challenges/[key] - Get challenges
POST   /api/challenges/[key] - Update challenges (deprecated)
PUT    /api/challenges/[key] - Update single challenge
DELETE /api/challenges/[key] - Clear challenges
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
# Clone the repository
git clone https://github.com/pmboutet/modal.git
cd modal

# Install dependencies
npm install

# Copy environment variables
cp .env.local.example .env.local

# Configure your environment variables
# Edit .env.local with your Supabase credentials and AI provider keys

# Run development server
npm run dev
```

### Environment Variables

Create a `.env.local` file from the provided example and supply the values below. The sections are grouped so you can identify which settings you need for your deployment.

#### AI Providers
```env
# Clés d'API pour les modèles IA (exemples)
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=sk-mistral-...

# Identifiants optionnels si vous utilisez des endpoints personnalisés
CUSTOM_MODEL_API_KEY=sk-custom-...
CUSTOM_MODEL_BASE_URL=https://api.your-model.com/v1
```

#### Database & Persistence (Supabase via Vercel integration)
```env
# Core Supabase credentials (synced automatically when you connect the Vercel ↔ Supabase integration)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# Mirror the project URL and anon key above so the browser can call Supabase directly
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Optional: Postgres connection strings that Vercel keeps in sync with Supabase
POSTGRES_URL=postgresql://user:password@host:6543/postgres
POSTGRES_PRISMA_URL=postgresql://user:password@host:5432/postgres?pgbouncer=true&connection_limit=1
POSTGRES_URL_NON_POOLING=postgresql://user:password@host:5432/postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=super-secret-password
POSTGRES_HOST=db.supabase.co
POSTGRES_DATABASE=postgres
```

- When the Vercel project is linked to Supabase, these variables appear automatically in **Settings → Environment Variables**. For local development, run `vercel env pull .env.local` or copy the values into `.env.local` manually.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` should match the server-side values and are safe to expose to the browser.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` **server-only**; never ship them to the client or commit them to version control.
- Use the `POSTGRES_*` connection strings for SQL migrations, Prisma, BI tools, or debugging sessions instead of crafting your own `DATABASE_URL`.
- The recommended schema and sample data remain documented in [`DATABASE_SETUP.md`](./DATABASE_SETUP.md).


#### App URL & ASK Key Validation
```env
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ASK keys are used to identify sessions and should follow these rules:
# - At least 3 characters long
# - Less than 100 characters
# - Only letters, numbers, dots (.), dashes (-), and underscores (_)
# - Must contain at least one letter or number
#
# Valid examples:
# - test-key-123
# - user_session_456
# - session.id.789
# - ASK-2024-001
#
# Invalid examples:
# - ab (too short)
# - key with spaces (contains spaces)
# - key@domain.com (contains @)
# - --- (no alphanumeric characters)
#
# Test your ASK keys at: http://localhost:3000/test-key
```

## 🗃️ Database migrations

The project ships with a lightweight, file-based migration system tailored for Supabase/PostgreSQL. Migrations live in [`migrations/`](./migrations) and are executed by the Node.js runner in [`scripts/migrate.js`](./scripts/migrate.js).

### Directory conventions

- Every migration is a UTF-8 SQL file named with an incrementing prefix, e.g. `001_initial_schema.sql`, `002_add_status_flag.sql`.
- Each file runs inside a transaction and may optionally expose a rollback section separated by `-- //@UNDO`.
- The runner maintains a `schema_migrations` table (created automatically) so applied hashes are tracked and never re-run.

### Running migrations locally

1. Ensure `DATABASE_URL` (or `POSTGRES_URL`/`SUPABASE_MIGRATIONS_URL`) is present in your environment. Supabase projects can copy the pooled connection string from the dashboard.
2. (Supabase) Set `PGSSLMODE=require` so the script negotiates SSL.
3. Run the migration commands:

```bash
# Apply all pending migrations
npm run migrate

# Inspect applied vs pending migrations
npm run migrate:status

# Rollback a specific version (requires a -- //@UNDO section)
node scripts/migrate.js down 001
```

> ℹ️ The runner automatically loads `.env.local` followed by process environment variables. Keep secrets outside version control.

### Git-driven automation

A GitHub Actions workflow (`.github/workflows/database-migrations.yml`) executes the migrations whenever changes land on `main` or when triggered manually. To enable it:

1. Add a `SUPABASE_DATABASE_URL` repository secret that contains a full connection string (service role or designated migration user).
2. Optionally set `PGSSLMODE=require` and `PGSSLREJECTUNAUTHORIZED=false` in the workflow or repository variables.
3. Merge a pull request that modifies files in `migrations/` to `main`. The workflow checks out the code, installs dependencies with `npm ci`, and runs `npm run migrate`.

Because migrations run inside transactions with advisory locking, repeated runs are safe—committed migrations are skipped if their checksum matches. If you collaborate with automation, see [`docs/AGENT_MIGRATION_GUIDE.md`](./docs/AGENT_MIGRATION_GUIDE.md) for detailed conventions.

## 🌐 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard (Supabase, AI providers, etc.)
```

- Install the **Supabase** integration from your Vercel project settings to sync database credentials automatically.
- Pull those variables locally with `vercel env pull .env.local` so development uses the same connection details.

## 🔗 AI Configuration & Journalisation

- Rendez-vous sur `/admin/ai` pour visualiser et modifier les prompts, choisir les modèles (Anthropic/Mistral/etc.) et activer les variables disponibles.
- Consultez `/admin/ai/logs` pour auditer chaque requête envoyée aux fournisseurs IA (payload, réponse, durée, erreurs éventuelles).
- Les modèles sont enregistrés dans `ai_model_configs` et peuvent être créés ou mis à jour via les endpoints `/api/admin/ai/models`.

## 🔒 Security

- **Key-based Access**: All data is accessible only with valid ASK keys
- **Journalisation IA**: Tous les appels modèles sont journalisés et auditables
- **Input Sanitization**: All user inputs are validated and sanitized
- **File Upload Security**: File type and size validation
- **No Persistent Storage**: Demo uses in-memory storage (implement database for production)

## 🎨 Customization

### Styling
- Built with Tailwind CSS for easy customization
- CSS variables for color themes
- Responsive design with mobile support
- Dark mode ready (implement theme toggle as needed)

### Components
- Modular component architecture
- TypeScript for type safety
- Reusable UI components in `/src/components/ui/`
- Business logic components in `/src/components/chat/` and `/src/components/challenge/`

## 🧪 Testing

```bash
# Run type checking
npm run lint

# Build for production
npm run build

# Test the build
npm start

# Test ASK key validation
# Visit http://localhost:3000/test-key
```

## 📚 Usage Examples

### Creating an ASK Session
1. External system generates unique key: `ask-session-12345`
2. System posts ASK data to API
3. User receives link: `https://your-app.com/?key=ask-session-12345`
4. User clicks link and conversation begins

### File Upload Example
Users can drag & drop or click to upload:
- **Images**: JPG, PNG, GIF, WebP
- **Audio**: MP3, WAV, OGG, MP4
- **Documents**: PDF, DOC, DOCX, TXT

### Challenge Structure Example
```json
{
  "id": "challenge-1",
  "name": "Team Productivity",
  "pains": [
    {
      "id": "pain-1",
      "name": "Meeting Overload",
      "description": "Too many unproductive meetings",
      "kpiEstimations": [
        {
          "description": "Weekly meeting hours",
          "value": {
            "current": 15,
            "target": 8,
            "unit": "hours",
            "impact": "high"
          }
        }
      ]
    }
  ],
  "gains": [
    {
      "id": "gain-1", 
      "name": "Focused Work Time",
      "description": "More time for deep work",
      "kpiEstimations": [
        {
          "description": "Productivity increase",
          "value": {
            "expected": 30,
            "unit": "percent",
            "timeframe": "monthly"
          }
        }
      ]
    }
  ]
}
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

MIT License - see LICENSE file for details

## 📞 Support

For issues and questions:
1. Check the GitHub Issues
2. Review the API documentation above
3. Test your ASK keys at `/test-key`
4. Create a new issue with detailed description

---

Built with ❤️ using Next.js, TypeScript, and Tailwind CSS
