import type { PortfolioSeed } from "./portfolio-seed.types.ts";

export const PORTFOLIO_SEED: PortfolioSeed = {
  users: {
    ios: {
      email: "maya.portfolio@example.com",
      username: "Maya",
      password: "portfolio-demo-1",
    },
    android: {
      email: "leo.portfolio@example.com",
      username: "Leo",
      password: "portfolio-demo-1",
    },
  },
  clips: [
    {
      id: "01-compose",
      room: "trail-weekend",
      e2ee: false,
      history: [],
      live: [
        { from: "ios", text: "Hey! Want to do the Ridgeline loop this Saturday?" },
      ],
    },
    {
      id: "02-two-authors",
      room: "tent-and-gear",
      e2ee: false,
      history: [
        { from: "android", text: "Did you check the forecast for Saturday yet?" },
        { from: "ios", text: "Yes, clear until noon then some wind. Pretty good." },
        { from: "android", text: "Nice. Should we start early to beat the heat?" },
        { from: "ios", text: "Agreed, leaving by 7. I'll bring the coffee." },
      ],
      live: [
        { from: "android", text: "Perfect, I'll grab the sandwiches on the way." },
        { from: "ios", text: "Don't forget the trail map, the app drops signal." },
        { from: "android", text: "Already on it. Packed the map and first-aid kit." },
      ],
    },
    {
      id: "03-offline-merge",
      room: "trail-signal-check",
      e2ee: false,
      history: [
        { from: "ios", text: "Anyone still up for the trail this weekend?" },
        { from: "android", text: "Yes! Let's lock in the campsite tonight." },
      ],
      live: [
        { from: "ios", text: "Booking the site now, give me a minute." },
      ],
      offline: {
        ios: [
          "Found a spot with a water tap near the north loop.",
          "I'll drive, so we can split the gas money after.",
        ],
        android: [
          "Great, that saves us hauling extra water.",
          "Pack light, the last climb is steeper than it looks.",
        ],
      },
    },
    {
      id: "04-e2ee",
      room: "surprise-cabin",
      e2ee: true,
      history: [],
      live: [
        { from: "ios", text: "Sam's birthday cake is ordered, don't tell him." },
        { from: "android", text: "Got it. I'll pick up the candles on Friday." },
        { from: "ios", text: "The cabin lockbox code is in the booking email." },
        { from: "android", text: "Found it, thanks. Keep the surprise quiet at dinner." },
      ],
    },
  ],
  extraRooms: ["groceries-list", "book-club", "neighbors-bbq"],
};
