# Example: the one message asking for the human-only steps of a new white-label game

Arena Chase is set up as its own app (`apps/arena-chase`) and its skeleton passes the scaffold check.
I keep building the rules, the sim and the board with placeholders meanwhile. To make it a real store
app I need eight things from you; each says what applies until it is done.

1. **The name (1 minute).** I used "Arena Chase" in English and Arabic. Reply "ok", or send the name
   per language.
2. **Store records (about 5 minutes).** Create the App Store Connect app and the Google Play app with
   the id `com.acme.arenachase` (it can never change after the first upload). Until then the builds
   run on simulators and emulators, and nothing uploads.
3. **Privacy and support (about 5 minutes).** Send the privacy-policy address and the support e-mail
   for Arena Chase. Until then the app carries `example.com` and `support@example.com`, which the
   complete check refuses by name, so nothing can ship with them.
4. **Ads (about 10 minutes).** Create the iOS and Android AdMob apps and a banner and a rewarded unit
   on each, and send me the six ids. Until then every build shows Google's test ads only, and the
   complete check refuses the sample ids.
5. **Premium (about 5 minutes per store).** Create the product `com.acme.arenachase.premium` in both
   stores. Until then purchases cannot be tested.
6. **Privacy answers (about 15 minutes).** Fill in App Privacy in App Store Connect and the Data
   safety form in Google Play with the answers I prepared from the privacy audit (the default: ads
   with the consent prompt, no account, no other data collected). Until then nothing can be
   submitted for review.
7. **Age rating (about 10 minutes).** Answer Apple's age-rating questionnaire and the IARC
   questionnaire in Google Play (the default for this game: no violence beyond cartoon chasing, no
   gambling, no user content). Until then nothing can be submitted.
8. **Store listing (about 10 minutes).** Approve the listing texts and screenshots I prepare (title,
   subtitle or short description, description, keywords, in English and Arabic). Until you approve
   them nothing is submitted; I will not publish anything without your go-ahead.

Not blocking, whenever you like: play the internal-testing build once it exists (TestFlight and Play
internal testing), and read the drafted Arabic texts (they are on the review queue).

What I cannot check without you: the store records, the privacy link, real ads and real purchases.
