const {
	SlashCommandBuilder,
	PermissionFlagsBits,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	StringSelectMenuBuilder,
} = require("discord.js");

// Simple parser to extract ID and name from custom emoji format (<:name:id> or <a:name:id>)
function parseEmoji(emojiStr) {
	if (!emojiStr) return null;
	const customEmojiRegex = /^<a?:([a-zA-Z0-9_]+):([0-9]+)>$/;
	const match = emojiStr.match(customEmojiRegex);
	if (match) {
		return { name: match[1], id: match[2] };
	}
	return emojiStr;
}

// Build the Discord message payload (embed + components) for a reaction role panel
function buildPanelMessage(panel, guild) {
	if (panel.groups.length > 5) throw new Error("A panel can have a maximum of 5 groups.");
	let reactionCount = 0;
	for (const group of panel.groups) {
		const customId = group.type === "button"
			? `reactionrole:button:${panel.messageId}:${group.name}:${"0".repeat(20)}`
			: `reactionrole:dropdown:${panel.messageId}:${group.name}`;
		if (!group.name || group.name.includes(":") || customId.length > 100) {
			throw new Error("Group names must be nonempty, contain no colons, and fit Discord's 100-character component ID limit.");
		}
		if (group.type === "dropdown" && group.roles.length > 25) {
			throw new Error("A dropdown can have a maximum of 25 role options.");
		}
		if (group.type === "emoji") reactionCount += group.roles.length;
	}
	if (reactionCount > 20) throw new Error("A message can have a maximum of 20 emoji reactions.");

	const embed = new EmbedBuilder()
		.setTitle(panel.title)
		.setDescription(panel.description || null)
		.setColor(panel.color || "#5865F2")
		.setTimestamp()
		.setFooter({ text: `Reaction Roles • ID: ${panel.messageId}` });

	const components = [];

	for (const group of panel.groups) {
		if (group.roles.length === 0) continue;

		// Add roles listing to embed fields
		const roleLines = group.roles.map((r) => {
			const role = guild.roles.cache.get(r.roleId);
			const roleMention = role ? `<@&${r.roleId}>` : `Unknown Role (${r.roleId})`;
			if (group.type === "emoji") {
				return `${r.emoji || "❓"} ➔ ${roleMention}`;
			} else {
				return `${r.emoji ? `${r.emoji} ` : ""}${r.label || "Role"} ➔ ${roleMention}`;
			}
		});

		embed.addFields({
			name: `${group.label}${group.description ? ` - *${group.description}*` : ""}`,
			value: roleLines.join("\n") || "No roles configured",
		});

		if (group.type === "dropdown") {
			const options = group.roles.map((r) => {
				const role = guild.roles.cache.get(r.roleId);
				const label = r.label || (role ? role.name : `Role ${r.roleId}`);
				const parsedEmoji = parseEmoji(r.emoji);

				const option = {
					label: label.substring(0, 100),
					value: r.roleId,
				};

				if (r.description) {
					option.description = r.description.substring(0, 100);
				}
				if (parsedEmoji) {
					option.emoji = parsedEmoji;
				}
				return option;
			});

			const selectMenu = new StringSelectMenuBuilder()
				.setCustomId(`reactionrole:dropdown:${panel.messageId}:${group.name}`)
				.setPlaceholder(group.label.substring(0, 150))
				.addOptions(options);

			if (group.selectionMode === "multiple") {
				selectMenu.setMinValues(0);
				selectMenu.setMaxValues(group.roles.length);
			} else if (group.selectionMode === "exclusive") {
				selectMenu.setMinValues(1);
				selectMenu.setMaxValues(1);
			} else {
				// single
				selectMenu.setMinValues(0);
				selectMenu.setMaxValues(1);
			}

			components.push(new ActionRowBuilder().addComponents(selectMenu));
		} else if (group.type === "button") {
			// Buttons must be in rows of 5
			let currentRow = new ActionRowBuilder();
			group.roles.forEach((r, idx) => {
				if (idx > 0 && idx % 5 === 0) {
					components.push(currentRow);
					currentRow = new ActionRowBuilder();
				}

				const role = guild.roles.cache.get(r.roleId);
				const label = r.label || (role ? role.name : "Role");
				const parsedEmoji = parseEmoji(r.emoji);

				const button = new ButtonBuilder()
					.setCustomId(`reactionrole:button:${panel.messageId}:${group.name}:${r.roleId}`)
					.setLabel(label.substring(0, 80))
					.setStyle(ButtonStyle.Secondary);

				if (parsedEmoji) {
					button.setEmoji(parsedEmoji);
				}

				currentRow.addComponents(button);
			});

			if (currentRow.components.length > 0) {
				components.push(currentRow);
			}
		}
	}

	if (components.length > 5) throw new Error("A panel can have a maximum of 5 action rows (5 buttons per row or 1 dropdown per row).");
	// Validate before persisting a panel, not after Discord rejects its message.
	const json = embed.toJSON();
	const embedLength = (json.title || "").length + (json.description || "").length +
		(json.footer?.text || "").length + (json.fields || []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
	if (embedLength > 6000) throw new Error("Panel embed text must not exceed 6000 characters.");
	for (const row of components) row.toJSON();
	return { embeds: [embed], components };
}

// React to the message with configured emojis for emoji group roles
async function refreshReactions(message, panel, ctx) {
	const targetEmojis = [];
	for (const group of panel.groups) {
		if (group.type === "emoji") {
			for (const role of group.roles) {
				if (role.emoji) {
					targetEmojis.push(role.emoji);
				}
			}
		}
	}

	if (targetEmojis.length === 0) return;

	for (const emoji of targetEmojis) {
		try {
			const parsed = parseEmoji(emoji);
			const reactionEmoji = typeof parsed === "object" ? parsed.id : parsed;
			// check if reaction already exists
			const existingReaction = message.reactions.cache.get(reactionEmoji);
			const botReacted = existingReaction ? existingReaction.me : false;
			if (!botReacted) {
				await message.react(emoji);
			}
		} catch (err) {
			if (ctx && ctx.logger) {
				ctx.logger.error(`Failed to add reaction emoji ${emoji}:`, err);
			}
		}
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName("reactionrole")
		.setDescription("Manage reaction role panels")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand((sub) =>
			sub
				.setName("create")
				.setDescription("Create a new reaction role panel message")
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription("The channel to send the panel in")
						.setRequired(true)
				)
				.addStringOption((opt) =>
					opt
						.setName("title")
						.setDescription("The title of the panel embed")
						.setRequired(true)
				)
				.addStringOption((opt) =>
					opt
						.setName("description")
						.setDescription("The description of the panel embed")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("color")
						.setDescription("Embed hex color code (e.g., #5865F2)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_name")
						.setDescription("Internal identifier for the initial group (default: default)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_label")
						.setDescription("Display label for the initial group (default: Select Roles)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("type")
						.setDescription("Group display type")
						.setRequired(false)
						.addChoices(
							{ name: "Dropdown Select Menu", value: "dropdown" },
							{ name: "Buttons", value: "button" },
							{ name: "Emoji Reactions", value: "emoji" }
						)
				)
				.addStringOption((opt) =>
					opt
						.setName("selection_mode")
						.setDescription("Role selection mode")
						.setRequired(false)
						.addChoices(
							{ name: "Multiple Roles (Select/Deselect Any)", value: "multiple" },
							{ name: "Single Role (Toggle at most one)", value: "single" },
							{ name: "Exclusive Role (Must have exactly one)", value: "exclusive" }
						)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName("add")
				.setDescription("Add a role option to a reaction role panel")
				.addStringOption((opt) =>
					opt
						.setName("message_id")
						.setDescription("The message ID of the reaction role panel")
						.setRequired(true)
				)
				.addRoleOption((opt) =>
					opt
						.setName("role")
						.setDescription("The role to award")
						.setRequired(true)
				)
				.addStringOption((opt) =>
					opt
						.setName("emoji")
						.setDescription("Emoji for this role (required for Emoji Reactions, optional for others)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("label")
						.setDescription("Button/Dropdown display label (defaults to role name)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("description")
						.setDescription("Dropdown description (Dropdown only)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_name")
						.setDescription("The name of the group to add this role to (created if it doesn't exist)")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_label")
						.setDescription("Display label if creating a new group")
						.setRequired(false)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_type")
						.setDescription("Group display type if creating a new group")
						.setRequired(false)
						.addChoices(
							{ name: "Dropdown Select Menu", value: "dropdown" },
							{ name: "Buttons", value: "button" },
							{ name: "Emoji Reactions", value: "emoji" }
						)
				)
				.addStringOption((opt) =>
					opt
						.setName("group_mode")
						.setDescription("Role selection mode if creating a new group")
						.setRequired(false)
						.addChoices(
							{ name: "Multiple Roles (Select/Deselect Any)", value: "multiple" },
							{ name: "Single Role (Toggle at most one)", value: "single" },
							{ name: "Exclusive Role (Must have exactly one)", value: "exclusive" }
						)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName("remove")
				.setDescription("Remove a role option from a reaction role panel")
				.addStringOption((opt) =>
					opt
						.setName("message_id")
						.setDescription("The message ID of the reaction role panel")
						.setRequired(true)
				)
				.addRoleOption((opt) =>
					opt
						.setName("role")
						.setDescription("The role to remove")
						.setRequired(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName("delete")
				.setDescription("Delete a reaction role panel completely")
				.addStringOption((opt) =>
					opt
						.setName("message_id")
						.setDescription("The message ID of the panel to delete")
						.setRequired(true)
				)
		)
		.addSubcommand((sub) =>
			sub
				.setName("list")
				.setDescription("List all reaction role panels in this server")
		)
		.addSubcommand((sub) =>
			sub
				.setName("refresh")
				.setDescription("Force-refresh a reaction role panel's message content and components")
				.addStringOption((opt) =>
					opt
						.setName("message_id")
						.setDescription("The message ID of the panel to refresh")
						.setRequired(true)
				)
		),

	execute: async (interaction, ctx) => {
		// Ensure member has permission
		if (!interaction.guildId || !interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) {
			return interaction.reply({
				content: "❌ You need the **Manage Server** permission to use this command.",
				ephemeral: true,
			});
		}

		const subcommand = interaction.options.getSubcommand();
		const ReactionPanel = ctx.defineModel("reactionPanel", require("../models/reactionPanel"));

		if (subcommand === "create") {
			await interaction.deferReply({ ephemeral: true });

			const channel = interaction.options.getChannel("channel");
			const title = interaction.options.getString("title");
			const description = interaction.options.getString("description");
			const color = interaction.options.getString("color");
			const groupName = (interaction.options.getString("group_name") || "default")
				.toLowerCase()
				.trim()
				.replace(/\s+/g, "_");
			const groupLabel = interaction.options.getString("group_label") || "Select Roles";
			const type = interaction.options.getString("type") || "dropdown";
			const selectionMode = interaction.options.getString("selection_mode") || "multiple";

			if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
				return interaction.editReply({
					content: "❌ Invalid hex color format. Use e.g. `#5865F2`.",
				});
			}
			const groupData = { name: groupName, label: groupLabel, type, selectionMode, roles: [] };
			try {
				buildPanelMessage({ title, description, color, groups: [groupData], messageId: "0".repeat(20) }, interaction.guild);
			} catch (err) {
				return interaction.editReply({ content: `Invalid panel: ${err.message}` });
			}
			if (!channel || typeof channel.send !== "function" || channel.isTextBased?.() === false) {
				return interaction.editReply({ content: "Select a text-based channel for the panel." });
			}

			// Validate channel permissions
			const botMember = await interaction.guild.members.fetchMe();
			const channelPerms = channel.permissionsFor(botMember);
			if (!channelPerms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
				return interaction.editReply({
					content: `❌ I do not have permission to send messages and embeds in <#${channel.id}>.`,
				});
			}

			// Send placeholder panel message first
			const initialEmbed = new EmbedBuilder()
				.setTitle(title)
				.setDescription(description || null)
				.setColor(color || "#5865F2")
				.setFooter({ text: "Setting up..." });

			const message = await channel.send({ embeds: [initialEmbed] }).catch((err) => {
				ctx.logger.error("Failed to send panel message:", err);
				return null;
			});

			if (!message) {
				return interaction.editReply({
					content: "❌ Failed to send the panel message in that channel. Check my permissions.",
				});
			}

			// Create database entry
			const panel = await ReactionPanel.create({
				guildId: interaction.guildId,
				channelId: channel.id,
				messageId: message.id,
				title,
				description,
				color: color || "#5865F2",
				groups: [groupData],
			});

			// Build and edit real panel message
			const payload = buildPanelMessage(panel, interaction.guild);
			await message.edit(payload);

			return interaction.editReply({
				content: `✅ Reaction Role Panel created successfully in <#${channel.id}>!\n**Message ID:** \`${message.id}\`\nUse \`/reactionrole add\` with this Message ID to start adding role options.`,
			});
		}

		if (subcommand === "add") {
			await interaction.deferReply({ ephemeral: true });

			const messageId = interaction.options.getString("message_id");
			const role = interaction.options.getRole("role");
			const emoji = interaction.options.getString("emoji");
			const label = interaction.options.getString("label");
			const description = interaction.options.getString("description");
			const groupName = interaction.options.getString("group_name")
				? interaction.options.getString("group_name").toLowerCase().trim().replace(/\s+/g, "_")
				: null;
			const groupLabel = interaction.options.getString("group_label");
			const groupType = interaction.options.getString("group_type");
			const groupMode = interaction.options.getString("group_mode");

			const panel = await ReactionPanel.findOne({ guildId: interaction.guildId, messageId });
			if (!panel) {
				return interaction.editReply({
					content: "❌ No reaction role panel configuration found with that Message ID.",
				});
			}

			// Find target group or create new one
			let group;
			if (groupName) {
				group = panel.groups.find((g) => g.name === groupName);
				if (!group) {
					panel.groups.push({
						name: groupName,
						label: groupLabel || groupName,
						type: groupType || "dropdown",
						selectionMode: groupMode || "multiple",
						roles: [],
					});
					// Mongoose casts pushed subdocuments into new objects.
					group = panel.groups[panel.groups.length - 1];
				}
			} else {
				// Default to first group
				group = panel.groups[0];
				if (!group) {
					panel.groups.push({ name: "default", label: "Select Roles", type: "dropdown", selectionMode: "multiple", roles: [] });
					group = panel.groups[0];
				}
			}

			if (panel.groups.length > 5) {
				return interaction.editReply({
					content: "❌ A panel can have a maximum of 5 groups due to Discord UI limits.",
				});
			}

			// Check if role already exists in the panel (in any group)
			let roleExists = false;
			for (const g of panel.groups) {
				if (g.roles.some((r) => r.roleId === role.id)) {
					roleExists = true;
					break;
				}
			}

			if (roleExists) {
				return interaction.editReply({
					content: `❌ The role **${role.name}** is already configured in this reaction role panel.`,
				});
			}

			// Emoji is required for emoji-type reaction groups
			if (group.type === "emoji" && !emoji) {
				return interaction.editReply({
					content: "❌ An emoji is **required** when adding a role to an Emoji Reaction group.",
				});
			}

			// Validate emoji if provided
			if (emoji) {
				const isUnicode = /\p{Emoji}/u.test(emoji);
				const isCustom = /^<a?:[a-zA-Z0-9_]+:[0-9]+>$/.test(emoji);
				if (!isUnicode && !isCustom) {
					return interaction.editReply({
						content: "❌ Invalid emoji format. Please provide a standard Unicode emoji or a valid custom Discord emoji (e.g. <:emoji_name:id>).",
					});
				}

				// Check if emoji is already in use in this panel
				let emojiExists = false;
				for (const g of panel.groups) {
					if (g.roles.some((r) => r.emoji === emoji)) {
						emojiExists = true;
						break;
					}
				}

				if (emojiExists) {
					return interaction.editReply({
						content: `❌ The emoji ${emoji} is already in use for another role on this panel.`,
					});
				}
			}

			// Check bot role hierarchy
			const botMember = await interaction.guild.members.fetchMe();
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.id === interaction.guildId ||
				!(role.position < botMember.roles.highest.position)) {
				return interaction.editReply({
					content: `I cannot assign/remove **${role.name}**. Check Manage Roles permission, role hierarchy, and whether the role is managed or @everyone.`,
				});
			}

			// Add role to group
			group.roles.push({
				roleId: role.id,
				emoji: emoji || null,
				label: label || role.name,
				description: description || null,
			});

			let payload;
			try {
				payload = buildPanelMessage(panel, interaction.guild);
			} catch (err) {
				return interaction.editReply({ content: `Invalid panel: ${err.message}` });
			}
			// Save only after validating all embed and component limits.
			await panel.save();

			// Edit discord message
			const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
			if (!channel) {
				return interaction.editReply({
					content: "❌ Panel channel could not be found. Did you delete it?",
				});
			}

			const message = await channel.messages.fetch(panel.messageId).catch(() => null);
			if (!message) {
				return interaction.editReply({
					content: "❌ Panel message could not be found. Did you delete it? Use `/reactionrole refresh` to recreate it.",
				});
			}

			await message.edit(payload);

			// Add reactions if group is emoji type
			await refreshReactions(message, panel, ctx);

			return interaction.editReply({
				content: `✅ Successfully added role **${role.name}** to group **${group.label}**.`,
			});
		}

		if (subcommand === "remove") {
			await interaction.deferReply({ ephemeral: true });

			const messageId = interaction.options.getString("message_id");
			const role = interaction.options.getRole("role");

			const panel = await ReactionPanel.findOne({ guildId: interaction.guildId, messageId });
			if (!panel) {
				return interaction.editReply({
					content: "❌ No reaction role panel configuration found with that Message ID.",
				});
			}

			// Find role inside panel groups
			let foundGroup = null;
			let foundRoleIndex = -1;

			for (const group of panel.groups) {
				const idx = group.roles.findIndex((r) => r.roleId === role.id);
				if (idx !== -1) {
					foundGroup = group;
					foundRoleIndex = idx;
					break;
				}
			}

			if (!foundGroup || foundRoleIndex === -1) {
				return interaction.editReply({
					content: `❌ The role **${role.name}** is not configured on this reaction role panel.`,
				});
			}

			const removedRoleConfig = foundGroup.roles[foundRoleIndex];
			foundGroup.roles.splice(foundRoleIndex, 1);

			// Clean up group if it is not default and has no roles left
			if (foundGroup.name !== "default" && foundGroup.roles.length === 0) {
				panel.groups = panel.groups.filter((g) => g.name !== foundGroup.name);
			}

			await panel.save();

			// Edit panel message
			const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
			if (channel) {
				const message = await channel.messages.fetch(panel.messageId).catch(() => null);
				if (message) {
					const payload = buildPanelMessage(panel, interaction.guild);
					await message.edit(payload);

					// If it was an emoji role, remove bot's reaction
					if (removedRoleConfig.emoji) {
						const parsed = parseEmoji(removedRoleConfig.emoji);
						const emojiKey = typeof parsed === "object" ? parsed.id : parsed;
						const reactionObj = message.reactions.cache.get(emojiKey);
						if (reactionObj) {
							await reactionObj.users.remove(ctx.client.user.id).catch(() => null);
						}
					}
				}
			}

			return interaction.editReply({
				content: `✅ Successfully removed role **${role.name}** from the panel configuration.`,
			});
		}

		if (subcommand === "delete") {
			await interaction.deferReply({ ephemeral: true });

			const messageId = interaction.options.getString("message_id");

			const panel = await ReactionPanel.findOne({ guildId: interaction.guildId, messageId });
			if (!panel) {
				return interaction.editReply({
					content: "❌ No reaction role panel configuration found with that Message ID.",
				});
			}

			// Try to delete Discord message
			const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
			if (channel) {
				const message = await channel.messages.fetch(panel.messageId).catch(() => null);
				if (message) {
					await message.delete().catch((err) => {
						ctx.logger.error("Failed to delete panel message on discord:", err);
					});
				}
			}

			await ReactionPanel.deleteOne({ _id: panel._id });

			return interaction.editReply({
				content: `✅ Reaction Role Panel configuration (ID: \`${messageId}\`) has been deleted.`,
			});
		}

		if (subcommand === "list") {
			const panels = await ReactionPanel.find({ guildId: interaction.guildId });

			if (panels.length === 0) {
				return interaction.reply({
					content: "ℹ️ There are no reaction role panels configured on this server.",
					ephemeral: true,
				});
			}

			const embed = new EmbedBuilder()
				.setTitle("Reaction Role Panels")
				.setColor("#5865F2")
				.setTimestamp();

			const lines = panels.map((p, idx) => {
				const groupDetails = p.groups
					.map((g) => `${g.label} (${g.roles.length} roles, type: ${g.type})`)
					.join(", ");
				return `${idx + 1}. **${p.title}**\n   • **Message ID:** \`${p.messageId}\`\n   • **Channel:** <#${p.channelId}>\n   • **Groups:** ${groupDetails || "None"}`;
			});

			embed.setDescription(lines.join("\n\n"));

			return interaction.reply({
				embeds: [embed],
				ephemeral: true,
			});
		}

		if (subcommand === "refresh") {
			await interaction.deferReply({ ephemeral: true });

			const messageId = interaction.options.getString("message_id");

			const panel = await ReactionPanel.findOne({ guildId: interaction.guildId, messageId });
			if (!panel) {
				return interaction.editReply({
					content: "❌ No reaction role panel configuration found with that Message ID.",
				});
			}

			const channel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
			if (!channel) {
				return interaction.editReply({
					content: "❌ Panel channel could not be found.",
				});
			}

			let message = await channel.messages.fetch(panel.messageId).catch((err) => {
				if (err.code === 10008) return null; // Unknown Message, not a transient failure.
				throw err;
			});
			let recreated = false;

			let payload;
			try {
				payload = buildPanelMessage(panel, interaction.guild);
			} catch (err) {
				return interaction.editReply({ content: `Invalid panel: ${err.message}` });
			}

			if (!message) {
				// Recreate panel message if deleted
				message = await channel.send({ embeds: payload.embeds }).catch((err) => {
					ctx.logger.error("Failed to recreate panel message:", err);
					return null;
				});

				if (!message) {
					return interaction.editReply({
						content: "❌ Failed to recreate the panel message. Please verify channel permissions.",
					});
				}

				// Update database with new message ID
				panel.messageId = message.id;
				await message.edit(buildPanelMessage(panel, interaction.guild));
				await ReactionPanel.updateOne({ _id: panel._id, guildId: interaction.guildId }, { $set: { messageId: message.id } });
				recreated = true;
			} else {
				await message.edit(payload);
			}

			// Add/refresh emojis
			await refreshReactions(message, panel, ctx);

			return interaction.editReply({
				content: recreated
					? `✅ Panel message was missing, so it has been recreated in <#${panel.channelId}> (New Message ID: \`${message.id}\`).`
					: `✅ Panel message has been successfully refreshed.`,
			});
		}
	},
	buildPanelMessage, // Exported for use in event listeners
	parseEmoji, // Exported for use in event listeners
	refreshReactions, // Exported for use in event listeners
};
