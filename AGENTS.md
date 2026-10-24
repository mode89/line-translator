# line-translator

A LINE chat bot that translates messages. It runs as a Cloudflare Worker (plain JavaScript, no build step): LINE sends each chat message to the `/webhook` endpoint, and the bot replies in the same chat.
