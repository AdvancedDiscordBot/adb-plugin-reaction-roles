const { Schema } = require("mongoose");

// Per-user log of role grants/removes for the member-scope /me/self-roles
// page. Written at every point a panel actually adds/removes a role; the
// guild member's roles remain the source of truth.
module.exports = new Schema({
	guildId: { type: String, required: true, index: true },
	userId: { type: String, required: true, index: true },
	roleId: { type: String, required: true },
	label: { type: String, default: null },
	action: { type: String, required: true, enum: ["add", "remove"] },
	messageId: { type: String, default: null },
	createdAt: { type: Date, default: Date.now },
});
