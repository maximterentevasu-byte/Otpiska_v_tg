# TG Custdev Bot

Бот для кастдева пользователей, которые вышли из Telegram-группы.

## Что делает

1. Бот добавляется админом в Telegram-группу.
2. Когда пользователь выходит, бот записывает его `user_id`, `username`, группу и дату выхода в Google Sheets.
3. Бот генерирует персональную deep-link ссылку вида:

```text
https://t.me/YOUR_BOT_USERNAME?start=interview_USER_ID
```

4. Админ вручную пишет пользователю и отправляет ссылку.
5. Пользователь нажимает ссылку, бот запускает анкетирование.
6. Ответы записываются в Google Sheets.

## Google Sheets структура

Бот сам создаст листы и заголовки, если их нет:

### leavers

```text
user_id | username | first_name | group_id | group_title | left_at | status | interview_link | answers_json | completed_at
```

### answers

```text
user_id | username | reason_left | content_issue | missing_value | return_trigger | follow_up_allowed | completed_at
```

## Установка локально

```bash
npm install
cp .env.example .env
npm run dev
```

## Переменные окружения

```text
TELEGRAM_BOT_TOKEN=
BOT_USERNAME=
PUBLIC_URL=
WEBHOOK_SECRET=
PORT=3000
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
ALLOWED_GROUP_IDS=
```

`ALLOWED_GROUP_IDS` можно оставить пустым. Тогда бот будет учитывать все группы, где он админ.

Если хочешь ограничить двумя группами:

```text
ALLOWED_GROUP_IDS=-1001111111111,-1002222222222
```

## Настройка Telegram

1. Создай бота через `@BotFather`.
2. Добавь бота админом в обе группы.
3. Дай права админа.
4. После деплоя проверь, что webhook установлен.

## Настройка Google Sheets

1. Создай Google Sheet.
2. Создай Google Cloud Project.
3. Включи Google Sheets API.
4. Создай Service Account.
5. Скопируй email service account.
6. Дай этому email доступ Editor к таблице.
7. Сохрани email и private key в Railway env variables.

Важно для Railway:

```text
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Деплой на Railway

1. Создай новый проект в Railway.
2. Подключи GitHub repo.
3. Добавь env variables.
4. Railway сам выполнит `npm install` и `npm start`.
5. В `PUBLIC_URL` укажи публичный Railway domain.

## Проверка

1. Добавь бота в тестовую группу.
2. Выйди из группы тестовым аккаунтом.
3. Проверь лист `leavers`.
4. Открой deep link из таблицы.
5. Пройди вопросы.
6. Проверь листы `leavers` и `answers`.

## Ограничения

- Бот не может первым написать пользователю. Пользователь должен сам открыть бота через deep link.
- Для отслеживания выхода пользователей бот должен получать `chat_member` updates и быть админом группы.
- Если у пользователя нет username, в таблицу будет записан только `user_id` и имя.
- Сессии интервью сейчас хранятся в памяти процесса. Для production лучше добавить PostgreSQL или Redis.
