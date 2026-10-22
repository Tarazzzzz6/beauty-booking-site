# Booking Club — тексти для App Store і Google Play

Готові матеріали для сторінок застосунку в магазинах. Сам застосунок — сайт bookingclub.beauty в оболонці Capacitor (див. APPSTORE-PLAN.md і capacitor.config.json).

## Базові дані

| Поле | Значення |
|---|---|
| Назва (App Store, до 30 символів) | **Booking Club — Beauty MTL** |
| Назва (Google Play, до 30 символів) | **Booking Club — Beauty MTL** |
| Bundle ID / Application ID | `beauty.bookingclub.app` |
| Категорія | Lifestyle (App Store) · Lifestyle / Beauty (Google Play: «Стиль життя») |
| Віковий рейтинг | 4+ (App Store) · Everyone (Google Play) |
| Ціна | Безкоштовно |
| Сайт | https://bookingclub.beauty |
| Підтримка | hello@bookingclub.beauty |
| Політика приватності | https://bookingclub.beauty/privacy.html |

## Короткий опис (subtitle / short description)

**UA:** Запис у салони краси Монреаля за 30 секунд — без дзвінків.
**EN:** Book Montréal beauty salons in 30 seconds — no phone calls.

## Повний опис — UA

Booking Club — це запис до салонів краси та майстрів Монреаля, які говорять вашою мовою: українською, російською, англійською.

Манікюр, педикюр, брови й вії, стрижки та фарбування, барбери, масаж і косметологія — усе в одному каталозі з фото робіт, цінами й чесними годинами роботи.

Чому Booking Club:
• Запис за 30 секунд — без реєстрації й дзвінків
• Реальний календар: зайняті години не показуються, подвійних записів не буває
• Підтвердження і нагадування про візит у Telegram — за день і за 2 години
• Скасування в один дотик, якщо плани змінились
• Карта Монреаля: салони поруч із вами, від Downtown до Verdun і Laval
• Три мови інтерфейсу: українська, російська, англійська
• Майстри на дому позначені окремо — ви завжди знаєте, куди йдете

Для салонів і майстрів: підключення безкоштовне через нашого Telegram-бота — бронювання приходять прямо в Telegram, там же — календар, нагадування клієнтам і кабінет із вашими записами та цінами. 0% комісії з ваших записів.

## Full description — EN

Booking Club is the fastest way to book beauty salons and independent masters in Montréal — in Ukrainian, Russian, and English.

Manicures, pedicures, brows and lashes, haircuts and colouring, barbers, massage and cosmetology — one catalogue with real photos, clear prices and actual working hours.

Why Booking Club:
• Booking in 30 seconds — no sign-up, no phone calls
• A real calendar: taken slots disappear, double bookings don't happen
• Confirmation and visit reminders in Telegram — 24 hours and 2 hours before
• One-tap cancellation when plans change
• A Montréal map: salons near you, from Downtown to Verdun and Laval
• Three interface languages: Ukrainian, Russian, English
• Home-based masters are clearly labelled — you always know where you're going

For salons and masters: join for free through our Telegram bot — bookings land right in your Telegram, together with a calendar, client reminders, and a dashboard with your appointments and prices. 0% commission on your bookings.

## Ключові слова (App Store, до 100 символів)

манікюр монреаль, салон краси, запис онлайн, manucure montréal, nail salon montreal, beauty booking, lashes, barber

## Google Play — теги/ключові фрази

beauty booking Montréal, nail salon, manicure, lash extensions, barbershop, салон красоты Монреаль, маникюр Монреаль

## Скріншоти — що треба зняти (з реального сайту, 6.7" і 6.5")

1. Головна: каталог салонів із фото й цінами — підпис «Салони Монреаля, які говорять вашою мовою»
2. Профіль салону з кнопкою запису — «Запис за 30 секунд»
3. Календар зі слотами — «Без подвійних записів»
4. Карта Монреаля з пінами цін — «Салони поруч із вами»
5. Підтвердження запису з кнопкою Telegram — «Нагадування у Telegram»
6. Сторінка для салонів — «Ви салон? Підключайтесь безкоштовно»

## Що треба від власника (без цього сабміт неможливий)

1. **Apple Developer Program — $99 USD/рік**, реєстрація на власний Apple ID власника (бажано як організація/бізнес). Без цього в App Store не податись.
2. **Google Play Console — $25 USD одноразово**, на власний Google-акаунт власника.
3. Доступ до Mac для фінальної збірки й підпису iOS (або хмарна збірка — Codemagic/Ionic Appflow).
4. Підтвердити юридичну назву продавця (як показуватиметься в магазинах) і країну податкової реєстрації (Канада).

## Кроки сабміту (після готовності акаунтів)

1. `npm i @capacitor/core @capacitor/cli` у репозиторії, `npx cap add ios` і `npx cap add android` (конфіг уже готовий — capacitor.config.json).
2. Збірка iOS у Xcode → TestFlight → внутрішнє тестування на своїх пристроях.
3. Заповнити App Store Connect за цим файлом: назва, описи, ключові слова, скріншоти, URL політики приватності, віковий рейтинг.
4. Подача на ревʼю Apple (зазвичай 1–3 дні). Ризик Guideline 4.2 («просто сайт») — помʼякшується тим, що застосунок відкривається і як Telegram Mini App, а бронювання/нагадування йдуть через бота; за потреби додаємо нативні push-сповіщення.
5. Android: збірка AAB в Android Studio → Google Play Console → закритий тест → продакшн.
6. Після релізу: оновлення контенту не потребують нових сабмітів — сайт живий (server.url у конфігу), нативна оболонка міняється лише для нативних змін.
