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
| `assets/csl-logo.jpg` | CSL-logoen (vikinghode) |

## Databasen

Tabeller: `leagues` (navn + `config` jsonb med runder, løp, poengskala, divisjoner, logo),
`drivers`, `results` (`rid` = `r{runde}-{løpsnøkkel}`, f.eks. `r1-H`; rader, straff, halve poeng og
løpstid i `data` jsonb) og `admins` (e-post for arrangører).
Alle kan lese. Bare innloggede som står i `admins` (sjekkes med `is_admin()`) kan skrive.
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

## Design

Eksportene følger CSL-designet: rød tittelstripe (#FC0003), grønn header (#8ED152), blå stripete rader,
logo til venstre, gull/sølv/bronse for 1./2./3. plass i hvert løp. Selve nettsiden har eget mørkt/lyst
tema i Barlow / Barlow Condensed.

## Arbeidsflyt

- Commit og push til `main`; GitHub Pages publiserer automatisk på et par minutter.
- Bruk GitHubs noreply-adresse som commit-forfatter, ikke en privat e-post.
- Test logikk i `js/core.js` med Node mot eksempelfiler før endringer i poeng eller import.

## Åpent

- Supabase setter gratisprosjekter på pause etter 7 dager uten databaseaktivitet. En planlagt
  GitHub Actions-jobb som gjør et lite oppslag hver andre dag er foreslått, men ikke lagt inn ennå.
