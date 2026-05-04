import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

// ─── CONFIG ────────────────────────────────────────────────────────────────

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("ERROR: DISCORD_TOKEN environment variable is not set.");
  process.exit(1);
}

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger:  0xed4245,
  warning: 0xfee75c,
  info:    0x00b0f4,
};

const TICKET_CATEGORY_NAME = "TICKETS";
const HITTER_INVITE        = "https://discord.gg/KKQY3RGDfV";
const MM_INFO_IMAGE        = "https://cdn.discordapp.com/attachments/1476182925698666496/1500509972365049998/4C2C39E6-7931-421A-8247-A44E8FB2C40D.png?ex=69fa03cf&is=69f8b24f&hm=b789816c8714d62e2496837366dfc869a376222c868f93f2793af41ec3344421&";

const MM_INFO_TEXT = `1. Seller gives items to the middleman.
2. Buyer pays the seller.
3. Once the seller confirms the payment, middleman passes on the items to the buyer.

❗️Both traders must vouch the middleman after use.`;

const MM_FEE_TEXT = `**Middleman Fee Info**

Our fee structure is flexible depending on the trade agreement:

**Option 1 — Split 50/50:**
Both buyer and seller each pay half of the MM fee.

**Option 2 — One pays 100%:**
One party covers the full MM fee (agreed upon beforehand).

**Fee rates:**
• Standard trades: 5% of total trade value
• Minimum fee: $2.00
• High-value trades (>$500): negotiable — open a ticket to discuss

Use \`!confirm\` once both parties have agreed on the fee structure.`;

const HOWTO_TEXT = `**How to Use MM Service — Step by Step**

1️⃣ Click the 🎫 **Request Middleman** button to open a ticket
2️⃣ Wait for a staff member to join your ticket
3️⃣ Both buyer & seller must be present — use \`!add @user\` to add them
4️⃣ Clearly state the trade details (item, amount, platform)
5️⃣ Agree on who pays the MM fee (use \`!mmfee\` to see options)
6️⃣ Use \`!confirm\` once both sides agree to proceed
7️⃣ Follow the MM's instructions to complete the trade safely
8️⃣ Use \`!close\` to close the ticket when done

**Tips:**
• Never send funds before the MM instructs you to
• Screenshot all trade agreements as proof
• If something feels wrong, type \`!fuh @staff\` to ping for help`;

// ─── IN-MEMORY TICKET STORE ────────────────────────────────────────────────

const tickets = new Map();
let ticketCounter = 0;

// ─── CLIENT SETUP ──────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const MANAGE_CHANNELS = (1n << 4n).toString();

const slashCommands = [];

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot is online as ${c.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: slashCommands });
    console.log("✅ Slash commands registered globally");
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err.message);
  }
});

// ─── MESSAGE COMMANDS ──────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  const args    = message.content.slice(1).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  try {
    switch (command) {
      case "ticket":          await cmdTicketPanel(message); break;
      case "mminfo":          await cmdMmInfo(message); break;
      case "mmfee":           await cmdMmFee(message); break;
      case "confirm":         await cmdConfirm(message); break;
      case "add":             await cmdAdd(message); break;
      case "remove":          await cmdRemove(message); break;
      case "rename":          await cmdRename(message, args); break;
      case "transfer":        await cmdTransfer(message); break;
      case "fuh":             await cmdFuh(message); break;
      case "howto":           await cmdHowTo(message); break;
      case "close":           await cmdClose(message); break;
    }
  } catch (err) {
    console.error(`Error handling command !${command}:`, err);
  }
});

// ─── BUTTON + SLASH INTERACTIONS ──────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleTicketModal(interaction);
      return;
    }

    if (!interaction.isButton()) return;

    switch (interaction.customId) {
      case "create_ticket": await showTicketModal(interaction); break;
      case "fuh_yes":
        await interaction.reply({ content: `✅ Great! Here's the link to join:\n${HITTER_INVITE}`, flags: 64 });
        break;
      case "fuh_no":
        await interaction.reply({ content: "No problem! Let us know if you change your mind.", flags: 64 });
        break;
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
  }
});

// ─── MODAL: SHOW ───────────────────────────────────────────────────────────

async function showTicketModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_modal")
    .setTitle("Open a Middleman Ticket");

  const otherTraderInput = new TextInputBuilder()
    .setCustomId("other_trader")
    .setLabel("Who is the other trader?")
    .setPlaceholder("e.g. @username or their Discord tag")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const givingInput = new TextInputBuilder()
    .setCustomId("giving")
    .setLabel("What are you giving?")
    .setPlaceholder("e.g. $50 PayPal, 10x Item, etc.")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const otherGivingInput = new TextInputBuilder()
    .setCustomId("other_giving")
    .setLabel("What is the other trader giving?")
    .setPlaceholder("e.g. Roblox account, game items, etc.")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(
    new ActionRowBuilder().addComponents(otherTraderInput),
    new ActionRowBuilder().addComponents(givingInput),
    new ActionRowBuilder().addComponents(otherGivingInput),
  );

  await interaction.showModal(modal);
}

// ─── MODAL: SUBMIT ─────────────────────────────────────────────────────────

async function handleTicketModal(interaction) {
  if (interaction.customId !== "ticket_modal") return;

  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: 64 });

  const otherTrader = interaction.fields.getTextInputValue("other_trader");
  const giving      = interaction.fields.getTextInputValue("giving");
  const otherGiving = interaction.fields.getTextInputValue("other_giving");

  try {
    const ticketNum   = ++ticketCounter;
    const paddedNum   = String(ticketNum).padStart(4, "0");
    const channelName = `ticket-${paddedNum}`;

    const existing = guild.channels.cache.find(
      (ch) => ch.isTextBased() && ch.topic === interaction.user.id
    );

    if (existing) {
      await interaction.editReply({ content: `You already have an open ticket: <#${existing.id}>` });
      return;
    }

    let category = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === TICKET_CATEGORY_NAME
    );

    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: interaction.user.id,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    tickets.set(channel.id, {
      ownerId:   interaction.user.id,
      channelId: channel.id,
      guildId:   guild.id,
      createdAt: new Date(),
      number:    ticketNum,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`🎫 Ticket #${paddedNum}`)
      .setDescription(
        `Welcome <@${interaction.user.id}>!\n\n` +
        "A staff member will assist you shortly.\n" +
        "Use `!close` to close this ticket when done."
      )
      .addFields(
        { name: "👤 Other Trader",            value: otherTrader, inline: false },
        { name: "📦 You Are Giving",           value: giving,      inline: true  },
        { name: "📦 Other Trader Is Giving",   value: otherGiving, inline: true  },
      )
      .setTimestamp()
      .setFooter({ text: `MM Service • Ticket #${paddedNum}` });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🔒")
    );

    await channel.send({ embeds: [embed], components: [closeRow] });
    await interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
    console.log(`Ticket #${paddedNum} created for ${interaction.user.username}`);
  } catch (err) {
    console.error("Failed to create ticket:", err.message);
    if (err?.code === 50013) {
      await interaction.editReply({ content: "❌ The bot is missing **Manage Channels** permission. Please ask an admin to fix this in Server Settings → Roles." });
    } else {
      await interaction.editReply({ content: "❌ Something went wrong. Please try again." });
    }
  }
}

// ─── SLASH COMMAND HANDLER ─────────────────────────────────────────────────

async function handleSlashCommand(interaction) {
  switch (interaction.commandName) {
    case "ticket":
      await slashTicket(interaction);
      break;
    case "mminfo":
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle("ℹ️ Middleman Service Info")
            .setDescription(MM_INFO_TEXT)
            .setImage(MM_INFO_IMAGE)
            .setTimestamp()
            .setFooter({ text: "MM Service" }),
        ],
      });
      break;
    case "mmfee":
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle("💰 Middleman Fee Info")
            .setDescription(MM_FEE_TEXT)
            .setTimestamp()
            .setFooter({ text: "MM Service • Fee Structure" }),
        ],
      });
      break;
    case "howto":
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle("📖 How to Use MM Service")
            .setDescription(HOWTO_TEXT)
            .setTimestamp()
            .setFooter({ text: "MM Service • Guide" }),
        ],
      });
      break;
  }
}

async function slashTicket(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "You need **Manage Channels** permission to post a ticket panel.", ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🎫 Middleman Ticket System")
    .setDescription(
      "**Need a trusted middleman for your trade?**\n\n" +
      "Click the button below to open a private ticket.\n" +
      "A staff member will assist you with your transaction safely.\n\n" +
      "**Available Commands:**\n" +
      "`/mminfo` — MM service info\n" +
      "`/mmfee` — Fee structure\n" +
      "`!confirm` — Confirm trade agreement\n" +
      "`/howto` — How to use this service\n" +
      "`!close` — Close your ticket"
    )
    .setImage(MM_INFO_IMAGE)
    .setTimestamp()
    .setFooter({ text: "MM Service • Safe Trading" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Request Middleman")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎫")
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

// ─── COMMAND HANDLERS ──────────────────────────────────────────────────────

async function cmdTicketPanel(message) {
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply("You need **Manage Channels** permission to create a ticket panel.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("Open a Middleman Request")
    .setDescription(
      "Welcome to FunPay Marketplace! Before opening a ticket, please read our https://discord.com/channels/1386765727276601486/1387211615568662529\n\n" +
      "**Requirements**\n" +
      "• You must vouch your middleman in https://discord.com/channels/1386765727276601486/1386997727875039292 within 24 hours of trade completion.\n" +
      "› Failure to vouch will result in a permanent blacklist from our MM service.\n" +
      "› Creating troll tickets will result in an immediate MM ban.\n\n" +
      "**Disclaimer**\n" +
      "› We are not responsible for anything that occurs after a trade is completed.\n" +
      "› Duped items are not covered under any circumstances.\n\n" +
      "Press the button below to submit a request."
    )
    .setTimestamp()
    .setFooter({ text: "FunPay Marketplace • MM Service" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Request Middleman")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎫")
  );

  await message.channel.send({ embeds: [embed], components: [row] });
  await message.delete().catch(() => {});
}

async function cmdMmInfo(message) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle("ℹ️ Middleman Service Info")
    .setDescription(MM_INFO_TEXT)
    .setImage(MM_INFO_IMAGE)
    .setTimestamp()
    .setFooter({ text: "MM Service" });

  await message.channel.send({ embeds: [embed] });
}

async function cmdMmFee(message) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle("💰 Middleman Fee Info")
    .setDescription(MM_FEE_TEXT)
    .setTimestamp()
    .setFooter({ text: "MM Service • Fee Structure" });

  await message.channel.send({ embeds: [embed] });
}

async function cmdConfirm(message) {
  if (!tickets.has(message.channelId)) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle("✅ Trade Confirmed")
    .setDescription(
      `<@${message.author.id}> has confirmed the trade agreement.\n\n` +
      "Both parties should now follow the middleman's instructions to proceed safely."
    )
    .setTimestamp()
    .setFooter({ text: "MM Service • Trade Confirmation" });

  await message.channel.send({ embeds: [embed] });
}

async function cmdAdd(message) {
  const ticket = tickets.get(message.channelId);
  if (!ticket) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const isOwner = ticket.ownerId === message.author.id;
  const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isMod) {
    await message.reply("Only the ticket owner or staff can add users.");
    return;
  }

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Please mention a user to add. Usage: `!add @user`");
    return;
  }

  await message.channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  await message.channel.send(`✅ <@${target.id}> has been added to this ticket.`);
}

async function cmdRemove(message) {
  const ticket = tickets.get(message.channelId);
  if (!ticket) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const isOwner = ticket.ownerId === message.author.id;
  const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isMod) {
    await message.reply("Only the ticket owner or staff can remove users.");
    return;
  }

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Please mention a user to remove. Usage: `!remove @user`");
    return;
  }

  if (target.id === ticket.ownerId) {
    await message.reply("You cannot remove the ticket owner. Use `!transfer @user` to transfer ownership first.");
    return;
  }

  await message.channel.permissionOverwrites.edit(target.id, {
    ViewChannel: false,
    SendMessages: false,
  });

  await message.channel.send(`✅ <@${target.id}> has been removed from this ticket.`);
}

async function cmdRename(message, args) {
  const ticket = tickets.get(message.channelId);
  if (!ticket) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const isOwner = ticket.ownerId === message.author.id;
  const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isMod) {
    await message.reply("Only the ticket owner or staff can rename this channel.");
    return;
  }

  const newName = args.slice(2).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!newName) {
    await message.reply("Please provide a name. Usage: `!rename ticket <name>`");
    return;
  }

  await message.channel.setName(`ticket-${newName}`);
  await message.channel.send(`✅ Ticket renamed to **ticket-${newName}**`);
}

async function cmdTransfer(message) {
  const ticket = tickets.get(message.channelId);
  if (!ticket) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const isOwner = ticket.ownerId === message.author.id;
  const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isMod) {
    await message.reply("Only the ticket owner or staff can transfer ownership.");
    return;
  }

  const target = message.mentions.users.first();
  if (!target) {
    await message.reply("Please mention a user. Usage: `!transfer @user`");
    return;
  }

  ticket.ownerId = target.id;

  await message.channel.permissionOverwrites.edit(target.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  await message.channel.send(`✅ Ticket ownership has been transferred to <@${target.id}>.`);
}

async function cmdFuh(message) {
  const target  = message.mentions.users.first();
  const mention = target ? `<@${target.id}>` : "";

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("🥊 Wanna become a hitter?")
    .setDescription(
      `${mention ? `${mention}\n\n` : ""}` +
      "Are you interested in joining our team as a hitter?\n\n" +
      "Click **Yes** to get the server link, or **No** to decline."
    )
    .setTimestamp()
    .setFooter({ text: "MM Service • Recruitment" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fuh_yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId("fuh_no")
      .setLabel("No")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
  );

  await message.channel.send({ embeds: [embed], components: [row] });
}

async function cmdHowTo(message) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle("📖 How to Use MM Service")
    .setDescription(HOWTO_TEXT)
    .setTimestamp()
    .setFooter({ text: "MM Service • Guide" });

  await message.channel.send({ embeds: [embed] });
}

async function cmdClose(message) {
  const ticket = tickets.get(message.channelId);
  if (!ticket) {
    await message.reply("This command can only be used inside a ticket channel.");
    return;
  }

  const isOwner = ticket.ownerId === message.author.id;
  const isMod   = message.member?.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isMod) {
    await message.reply("Only the ticket owner or staff can close this ticket.");
    return;
  }

  const messages  = await message.channel.messages.fetch({ limit: 100 });
  const sorted    = [...messages.values()].reverse();
  const lines     = sorted.map((m) => {
    const time    = m.createdAt.toISOString().replace("T", " ").slice(0, 19);
    const author  = `${m.author.username}`;
    return `[${time}] ${author}: ${m.content || "[embed/attachment]"}`;
  });

  const transcript = `=== TRANSCRIPT: #${message.channel.name} ===\n\n${lines.join("\n")}\n\n=== END OF TRANSCRIPT ===`;
  const buffer     = Buffer.from(transcript, "utf-8");
  const attachment = new AttachmentBuilder(buffer, {
    name: `transcript-${message.channel.name}-${Date.now()}.txt`,
  });

  const closeEmbed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle("🔒 Ticket Closed")
    .setDescription(
      `Ticket closed by <@${message.author.id}>.\n` +
      "The transcript has been saved below.\n\n" +
      "This channel will be deleted in **5 seconds**."
    )
    .setTimestamp()
    .setFooter({ text: "MM Service • Ticket Closed" });

  await message.channel.send({ embeds: [closeEmbed], files: [attachment] });
  tickets.delete(message.channelId);

  setTimeout(() => message.channel.delete("Ticket closed").catch(() => {}), 5000);
}

// ─── BUTTON: CREATE TICKET ─────────────────────────────────────────────────

async function handleCreateTicket(interaction) {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: 64 });

  try {
    const ticketNum  = ++ticketCounter;
    const paddedNum  = String(ticketNum).padStart(4, "0");
    const channelName = `ticket-${paddedNum}`;

    const existing = guild.channels.cache.find(
      (ch) => ch.isTextBased() && ch.topic === interaction.user.id
    );

    if (existing) {
      await interaction.editReply({ content: `You already have an open ticket: <#${existing.id}>` });
      return;
    }

    let category = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === TICKET_CATEGORY_NAME
    );

    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      topic: interaction.user.id,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    tickets.set(channel.id, {
      ownerId:   interaction.user.id,
      channelId: channel.id,
      guildId:   guild.id,
      createdAt: new Date(),
      number:    ticketNum,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`🎫 Ticket #${paddedNum}`)
      .setDescription(
        `Welcome <@${interaction.user.id}>!\n\n` +
        "A staff member will assist you shortly.\n" +
        "Please describe your trade details.\n\n" +
        "Use `!close` to close this ticket when done."
      )
      .setTimestamp()
      .setFooter({ text: `MM Service • Ticket #${paddedNum}` });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🔒")
    );

    await channel.send({ embeds: [embed], components: [closeRow] });
    await interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
    console.log(`Ticket #${paddedNum} created for ${interaction.user.username}`);
  } catch (err) {
    console.error("Failed to create ticket:", err.message);
    if (err?.code === 50013) {
      await interaction.editReply({ content: "❌ The bot is missing **Manage Channels** permission. Please ask an admin to fix this in Server Settings → Roles." });
    } else {
      await interaction.editReply({ content: "❌ Something went wrong creating your ticket. Please try again." });
    }
  }
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────

client.login(TOKEN).catch((err) => {
  if (err.message?.includes("disallowed intents")) {
    console.error(
      "❌ PRIVILEGED INTENTS not enabled!\n" +
      "Go to: https://discord.com/developers/applications → your bot → Bot tab\n" +
      "Enable: 'Message Content Intent' + 'Server Members Intent'\n" +
      "Then restart the bot."
    );
  } else {
    console.error("❌ Failed to login:", err.message);
  }
  process.exit(1);
});
