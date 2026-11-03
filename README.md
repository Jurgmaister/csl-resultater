# CSL Resultater

Resultatprogram for Club Scandinavia League. Arrangørene setter opp ligaen, importerer resultatfiler
(CSV fra iRaceControl eller iRacing, JSON fra iRacing) og eksporterer resultater og standings til
PDF, PNG (Discord) og Excel/CSV i CSL-designet. Alle kan se standings og resultater uten å logge inn.

Nettsiden kjører på GitHub Pages. Data og innlogging ligger i Supabase.

## Oppsett (én gang)

### 1. Supabase
1. Lag et prosjekt på supabase.com.
2. Åpne **SQL Editor → New query**, lim inn hele `supabase/schema.sql`, bytt ut `DIN-EPOST@eksempel.no`
   nederst med din egen e-post, og trykk **Run**.
3. **Authentication → URL Configuration**:
   - *Site URL*: `https://jurgmaister.github.io/csl-resultater/`
   - *Redirect URLs*: legg til den samme adressen.
4. **Settings → API**: kopier *Project URL* og *publishable key* (eller anon public key) inn i `js/config.js`.

### 2. GitHub Pages
**Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, mappe `/ (root)`.
Siden blir tilgjengelig på `https://jurgmaister.github.io/csl-resultater/`.

## Arrangører
Arrangører legges til under **Oppsett → Arrangører** (e-postadresse). De logger inn med en lenke som
sendes på e-post. Supabase sin innebygde e-post tåler noen få innlogginger i timen. Blir det for lite,
kan dere koble på egen SMTP under *Authentication → Emails*.

## Filer
| Fil | Innhold |
|---|---|
| `index.html` | Siden, stil og oppbygning |
| `js/core.js` | Lesing av CSV/JSON, poeng, Division 2 og standings |
| `js/export.js` | PDF, PNG, Excel og CSV i CSL-design |
| `js/data.js` | Lagring i Supabase |
| `js/app.js` | Brukergrensesnittet |
| `js/config.js` | Supabase-adresse og offentlig nøkkel |
| `supabase/schema.sql` | Tabeller og tilgangsregler |
