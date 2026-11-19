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

## Arrangører og innlogging
Arrangører logger inn med e-post og passord. Første gang trykker de «Første gang? Lag passord».
Kontoen gir redigeringstilgang først når e-posten er lagt til under **Oppsett → Arrangører**
(den første arrangøren legges inn nederst i `supabase/schema.sql`).

I Supabase: **Authentication → Sign In / Providers → Email** – slå av *Confirm email*, så kan nye
arrangører lage passord uten å vente på e-post. «Glemt passord?» sender fortsatt en e-post, og
Supabase sin innebygde e-post tillater bare noen få slike i timen.

### Glemt passord
- «Glemt passord?» sender en lenke på e-post. Lenken åpner siden med et skjema for nytt passord.
  Adressen til siden må stå under *Redirect URLs* i Supabase (se Oppsett over).
- Arrangører kan hjelpe under **Oppsett → Passord for brukere**: sende lenken på nytt, eller sette et
  midlertidig passord som de gir til personen. Finnes ingen konto, opprettes den. Det krever at
  `supabase/passord.sql` er kjørt i Supabase én gang.
- Innloggede bytter passord ved å trykke på e-postadressen sin øverst til høyre.

## Protester
Førere sender inn protester uten å logge inn, og stewards avgjør dem. Alle kan lese sakene og avgjørelsene
under fanen **Protester**. Direktelenke til skjemaet (fin å legge i Discord):
`https://jurgmaister.github.io/csl-resultater/#protest`

Slik slår du det på:
1. Kjør `supabase/protester.sql` i Supabase (**SQL Editor → New query → lim inn → Run**). Den er også
   med nederst i `schema.sql` for nye prosjekter.
2. **Oppsett → Protester**: kryss av for «Ta imot protester», og sett frister, antall protester per
   runde og hendelsestyper. Sett dato og løpsslutt (klokkeslett) på rundene under **Runder**. Fristen (12, 24, 48 timer osv.)
   regnes fra løpsslutt, eller fra midnatt etter løpsdagen hvis klokkeslett mangler.
3. **Oppsett → Regler**: én regel per linje fra regelheftet (f.eks. «3.4 Overtaking»). Stewards velger regel
   fra denne listen når de avgjør en sak. «99 Annet» står alltid nederst, og da skriver stewarden regelen selv.
4. **Oppsett → Stewards**: legg til e-posten til dem som skal avgjøre saker (arrangører kan også).

I skjemaet velger føreren først løpsserie, deretter løp. Førerlistene hentes fra resultatfilen for
løpet (de som står i standings), og bilnummeret fylles ut automatisk. Førere kan:
- sende inn en protest med løp, egen fører, fører det protesteres mot, hendelsestype, bilnumre,
  runde, replay-tid, beskrivelse og lenke til video
- legge til svar eller nytt bevis før saken er avgjort (bare stewards ser det)
- anke en avgjørelse innen ankefristen

Siden ingen logger inn, kan i prinsippet hvem som helst sende inn i en førers navn. Databasen sjekker
at begge førerne var med i løpet, fristen og antall protester. Arrangører kan slette saker som er
spam eller feil.

En protest eller anke koster én av førerens protester for runden, og gis tilbake hvis den fører fram.

Når stewards publiserer en straff (poengtrekk, tidsstraff eller begge, eller DSQ) med «Legg straffen inn i resultatet»,
oppdateres resultatlisten og standings med en gang, og straffen vises med lenke til saken. Tidsstraff
legger sekunder til tiden og kan endre plasseringene. Mens saker er åpne, er resultatet merket «Foreløpig».

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
| `supabase/protester.sql` | Tabeller og funksjoner for protestsystemet (kjøres én gang i eksisterende prosjekt) |
| `supabase/passord.sql` | Funksjon som lar arrangører sette passord på brukere (kjøres én gang i eksisterende prosjekt) |
