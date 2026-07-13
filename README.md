# adb-plugin-reaction-roles

Reaction roles plugin for [Advanced Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot) (ADB).

Allows server administrators to create premium reaction role panels via slash commands with buttons, select menus, and emoji reactions.

## Features

- **Multiple Selection Modes**: Supports single (max 1), multiple (no limit), and exclusive (must have exactly 1) selection modes per role group.
- **Modern Message Components**: Utilizes modern Discord buttons and dropdown select menus, as well as traditional emoji reactions.
- **Grouping**: Group roles with labels and descriptions inside a single panel message (up to 5 groups/components per panel).
- **Auto-recreation / Refresh**: Recreate or sync the panel message instantly using the `/reactionrole refresh` command.
- **MongoDB Backend**: Persists panel configurations per guild.

## Installation

Add it to your Advanced Discord Bot plugins:

```bash
npm install adb-plugin-reaction-roles
```

## Slash Commands

| Command | Subcommand | Description |
|---|---|---|
| `/reactionrole` | `create` | Create a new reaction role panel message in a channel |
| `/reactionrole` | `add` | Add a role option to a reaction role panel |
| `/reactionrole` | `remove` | Remove a role option from a reaction role panel |
| `/reactionrole` | `delete` | Delete a reaction role panel completely |
| `/reactionrole` | `list` | List all reaction role panels in this server |
| `/reactionrole` | `refresh` | Sync or recreate a panel's message content and reactions |

## Local Testing

Run offline unit and integration tests against a mock PluginContext using:

```bash
npm test
```

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file for details.
