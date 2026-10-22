# Booking Club — шлях в App Store і Google Play

Сайт bookingclub.beauty — це PWA, тобто технічно вже застосунок: іконки, splash-екрани й офлайн-режим у репозиторії є. Для магазинів застосунків сайт загортається в нативну оболонку.

## Статус (оновлено 22.10.2026)
- ✅ PWA-версія сайту жива і стабільна
- ✅ **Політика приватності готова**: bookingclub.beauty/privacy.html (UA повна + RU/EN короткі)
- ✅ **Тексти для магазинів готові**: STORE-LISTING.md (назва, описи UA+EN, ключові слова, категорія, список скріншотів)
- ✅ **Конфіг Capacitor готовий**: capacitor.config.json (appId `beauty.bookingclub.app`, appName Booking Club, webDir `.`, server.url — живий сайт)
- ✅ Telegram Mini App: сайт коректно відкривається всередині Telegram (кнопка-меню бота + WebApp init)
- ⏳ Лишилось: **акаунти власника** (Apple Developer $99/рік, Google Play $25) і **нативна збірка** (Mac/Xcode для iOS, Android Studio для Android) — нативних проєктів у репозиторії свідомо немає: їх генерує `npx cap add` на машині з потрібним тулчейном, тут його немає.

## Варіант, який рекомендуємо: Capacitor
- [Capacitor](https://capacitorjs.com) (безкоштовний, від команди Ionic) пакує існуючий сайт у справжній iOS/Android застосунок без переписування коду
- Кроки: `npm i @capacitor/core @capacitor/cli` → `npx cap add ios` / `android` → збірка в Xcode / Android Studio
- Альтернатива без коду: PWABuilder (Microsoft) — генерує пакети для Google Play і частково iOS

## Що треба від власника
1. **Apple Developer Program — $99 USD/рік** (без нього в App Store ніяк). Реєстрація на власника бізнесу, бажано як організація/ФОП
2. **Google Play Console — $25 USD одноразово**
3. Доступ до Mac для фінальної збірки iOS (або хмарна збірка, напр. Ionic Appflow / Codemagic)

## Що зробить Muse перед подачею
- [ ] Перевірка PWA за чек-листом Apple/Google (іконки 1024×1024, splash, офлайн)
- [ ] Скріншоти для магазинів (6.7", 6.5", 5.5") з реального сайту — список кадрів у STORE-LISTING.md
- [x] Описи для магазинів (UA + EN) і ключові слова: manucure Montréal, манікюр Монреаль, маникюр Монреаль — у STORE-LISTING.md
- [x] Політика приватності (окрема сторінка на домені — обовʼязкова для обох магазинів): privacy.html
- [x] Конфіг Capacitor: capacitor.config.json
- [ ] Нативні дрібниці через Capacitor: статус-бар, splash, haptics на бронювання

## Ризики і чесні нотатки
- Apple інколи відхиляє «просто сайт в оболонці» (Guideline 4.2 — minimum functionality). Лікується нативними функціями: push-сповіщення про бронювання, Apple Pay для депозиту — вони ж у нашому роадмепі для монетизації
- Push-сповіщення — це також найкращий канал нагадувань клієнтам (менше no-show), тож потрібні і бізнесу, і для проходження ревʼю
- Термін ревʼю Apple: зазвичай 1–3 дні

## Порядок дій
1. ✅ Люкс-версія сайту живе й стабільна (перевірки Muse)
2. ✅ Політика приватності (privacy.html) + тексти магазинів (STORE-LISTING.md) + capacitor.config.json
3. Крок 3: реєстрація Apple Developer і Google Play власником ($99/рік + $25) — **це єдиний блокер**
4. Крок 4: збірка через Capacitor на машині власника, TestFlight для своїх, потім подача

## Як зібрати застосунки з capacitor.config.json
На компʼютері з Node.js і потрібним тулчейном (Mac + Xcode для iOS; Android Studio для Android), у клоні цього репозиторію:

```bash
npm i @capacitor/core @capacitor/cli
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios       # далі — підпис і TestFlight у Xcode
npx cap open android   # далі — збірка AAB в Android Studio
```

Конфіг навмисно вказує `server.url = https://bookingclub.beauty`: застосунок показує живий сайт, тож оновлення контенту не потребують нових сабмітів. Чесна вада підходу: Apple суворіше ревʼюїть «сайт в оболонці» (Guideline 4.2); якщо відхилять — наступний крок: пакувати статичні файли в застосунок (прибрати server.url, webDir `.` уже вказує на корінь репозиторію) і додати нативні push-сповіщення. Повні нативні проєкти (ios/, android/) у репозиторій не комітимо: їх генерує `npx cap add` під локальний тулчейн, якого на сервері Muse немає.
