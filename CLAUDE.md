# CSL Resultater

Resultatprogram for Club Scandinavia League (CSL), en individuell iRacing-liga. Arrangørene setter opp
ligaen, importerer resultatfiler og eksporterer resultater og standings i CSL-designet. Alle kan se
standings og resultater uten å logge inn.

- Nettside: https://jurgmaister.github.io/csl-resultater/ (GitHub Pages fra `main`, rotmappe)
- Data og innlogging: Supabase-prosjektet «CSL Resultater» (adresse og publishable key i `js/config.js`)
- Språk: grensesnittet er på norsk (bokmål). Eksporterte tabeller (PDF/PNG/Excel) har engelske
  overskrifter, slik CSL poster dem på Discord i dag.

## Oppbygning

Ren statisk side uten byggesteg: åpne `index.html` via en lokal webserver (f.eks. `python -m http.server`).
Biblioteker lastes fra CDN: supabase-js (jsDelivr), jsPDF (cdnjs) og xlsx-js-style (jsDelivr), de to
siste først når noen eksporterer.

| Fil | Innhold |
|---|---|
| `index.html` | Oppsett, all CSS (fargetokens for lyst/mørkt tema) og script-tagger |
| `js/core.js` | Ren logikk uten DOM: lesing av CSV/JSON, poeng, Division 2, standings. Kan testes i Node (`module.exports`) |
| `js/export.js` | PDF, PNG (canvas), Excel og CSV i CSL-design |
| `js/data.js` | Supabase-lag med doc()/collection()-grensesnitt mot stier som `leagues/{id}/results/{rid}` |
| `js/app.js` | Grensesnittet: faner Standings, Resultater, Importer, Førere, Oppsett; innlogging |
| `js/config.js` | Supabase-adresse og publishable key (offentlige, trygge i koden) |
| `supabase/schema.sql` | Tabeller, tilgangsregler (RLS) og sanntid |
| `supabase/protester.sql` | Protestsystemet alene (samme innhold som nederst i `schema.sql`), for eksisterende prosjekt |
| `supabase/passord.sql` | `admin_set_password()`: arrangør setter passord på en konto (samme innhold som nederst i `schema.sql`) |

Innlogging: `onAuthStateChange` må registreres rett etter `createClient`, ellers går `PASSWORD_RECOVERY`
fra «Glemt passord?»-lenken tapt. Arrangører lager kontoer for andre med en egen klient
(`persistSession: false`), slik at de selv ikke blir logget ut.
| `assets/csl-logo.jpg` | CSL-logoen (vikinghode) |

## Databasen

Tabeller: `leagues` (navn + `config` jsonb med runder, løp, poengskala, divisjoner, logo),
`drivers`, `results` (`rid` = `r{runde}-{løpsnøkkel}`, f.eks. `r1-H`; rader, straff, halve poeng og
løpstid i `data` jsonb) og `admins` (e-post for arrangører).
Alle kan lese. Bare innloggede som står i `admins` (sjekkes med `is_admin()`) kan skrive.

Protester: `protests` (sak per liga med løpende `no`, `decision` jsonb), `protest_events` (sakshistorikk;
`private` = bare stewards ser den; `token` -1/+1 teller protester per fører per runde) og `stewards`
(`is_steward()` = arrangør eller steward). Førere logger ikke inn: de skriver bare via funksjonene
`file_protest` og `protest_reply` (åpne for `anon`), som sjekker at førerne var med i løpet, frist,
video og antall protester (`protest_quota`). Stewards skriver direkte i `protests`/`protest_events`.
Oppsettet ligger i `leagues.config.protests` (`CORE.protestDefaults`), også reglene stewards velger i
avgjørelsen (`rules`; `CORE.protestRules` legger alltid til «99 Annet» med fritekst). `#protest` i adressen åpner skjemaet.
Endringer i skjemaet må kjøres manuelt i Supabase SQL Editor og legges inn i `supabase/schema.sql`.
Legg aldri inn `service_role`- eller secret-nøkkelen, og ingen e-postadresser, i koden.

## Regler for resultater

- Formater: CSV fra iRaceControl (har kolonnen «Car Type»; Interval = avstand til bilen foran, summeres
  til gap til vinneren), CSV fra iRacing (Interval = gap til leder) og JSON fra iRacing.
- Divisjon: «Car Class ID» i filen (1 = Div 1, 2 = Div 2) hvis den finnes, ellers førerlisten.
- Poeng etter plassering i klassen. Standard CSL-skala: 60-54-49-45-42-39-37-35-33-31, deretter 29 og
  ned med 1. Division 2 har egen rangering og egen poengfordeling (beste Div 2-fører får full poengsum).
- Status som begynner med «DQ» (f.eks. «DQInv») gir 0 poeng. Straff per fører: poengtrekk, DNF, DNS
  eller DSQ. DSQ flytter de bak opp en plass.
- Vinneren viser total løpstid: kolonnen «Race Time» hvis filen har den, ellers snittid × runder, eller
  tid lagt inn manuelt.
- Lik poengsum avgjøres av beste enkeltresultater (største poeng først).
- Straffer fra protestsaker lagres ikke i resultatet, men beregnes fra avgjorte saker (`decision.apply`,
  status `decided`/`closed`) med `CORE.protestPens` og sendes inn i `computeRace`/`computeStandings`.
  Gjenåpnes en sak, forsvinner straffen til den er avgjort på nytt. En sak kan ha flere straffer
  (`decision.pens`, eldre saker har bare `decision.pen`; les med `CORE.decisionPens`). Typer: poengtrekk, tidsstraff
  (sekunder på tiden for førere på samme runde som vinneren, sorterer på nytt) og DSQ. Manuelle straffer
  i `results.data.pen` kommer i tillegg.
- Protestfrist: rundens dato + løpsslutt (`rounds[i].end`, «HH:MM») + `deadlineH` timer (12–168, Europe/Oslo).
  Uten løpsslutt regnes den fra midnatt etter datoen. Runder uten dato har ingen frist. Samme regel i `file_protest` (SQL).

## Design

Eksportene følger CSL-designet: rød tittelstripe (#FC0003), grønn header (#8ED152), blå stripete rader,
logo til venstre, gull/sølv/bronse for 1./2./3. plass i hvert løp. Selve nettsiden har eget mørkt/lyst
tema i Barlow / Barlow Condensed.

## Arbeidsflyt

- Commit og push til `main`; GitHub Pages publiserer automatisk på et par minutter.
- Bytt `?v=` på script-taggene i `index.html` (til dagens dato) når JS-filer endres, ellers kan
  nettleseren bruke en gammel kopi.
- Bruk GitHubs noreply-adresse som commit-forfatter, ikke en privat e-post.
- Test logikk i `js/core.js` med Node mot eksempelfiler før endringer i poeng eller import.

## Åpent

- Supabase setter gratisprosjekter på pause etter 7 dager uten databaseaktivitet. En planlagt
  GitHub Actions-jobb som gjør et lite oppslag hver andre dag er foreslått, men ikke lagt inn ennå.
