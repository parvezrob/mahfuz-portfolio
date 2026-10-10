// Every word and link on the site lives here. Leave a contact field empty to hide it.
export const site = {
  name: { first: "Mahfuz", last: "Chowdhury" },
  role: "Websites, CRM, automation and paid ads, built as one system.",
  url: "https://mahfuzchowdhury.com",
  year: 2026,

  statement: [
    "Most leads are lost between the first click and the booked call.",
    "I build what catches them.",
  ],

  acts: [
    {
      id: "build",
      word: "Build",
      line: "Websites, landing pages and funnels that give every visitor one clear next step.",
      items: ["Websites", "Landing pages", "Funnels"],
    },
    {
      id: "automate",
      word: "Automate",
      line: "A CRM that answers, reminds and books without anyone chasing.",
      items: ["GoHighLevel", "CRM pipelines", "AI follow-up"],
    },
    {
      id: "grow",
      word: "Grow",
      line: "Meta and Google campaigns, tracked from the ad to the booked call.",
      items: ["Meta Ads", "Google Ads", "Tracking and reporting"],
    },
  ],

  // The three hoops in the Automate scene light these words of its sentence, in order.
  followUp: ["answers", "reminds", "books"],

  about: {
    lines: [
      "I’m Mahfuz.",
      "I’ve been a creative director at LofiStack, an IT support engineer at MassMarket and an automation engineer at Biofocal. That is why I build the whole system, not one piece of it.",
    ],
  },

  // Product shots of the things a client ends up with. Generated stand-ins, labelled as such.
  samples: {
    heading: "What you get.",
    note: "Illustrative samples.",
    items: [
      { id: "site", title: "Landing pages", line: "One message, one action." },
      { id: "crm", title: "Pipelines", line: "Every lead in a stage, with a next step." },
      { id: "followup", title: "Follow-up", line: "Replies and reminders that run on their own." },
      { id: "ads", title: "Reporting", line: "Spend judged by booked calls." },
    ],
  },

  contact: {
    heading: "Let’s build yours.",
    // PLACEHOLDERS. While `placeholder` is true the links are shown but go nowhere.
    // Fill in the real details, then set it to false.
    placeholder: true,
    email: "hello@example.com",
    whatsapp: "+000 0000 000000",
    linkedin: "https://www.linkedin.com/in/your-profile",
    bookingUrl: "",
  },
} as const;
