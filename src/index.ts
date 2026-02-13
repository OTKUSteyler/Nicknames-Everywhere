/**
 * Nicknames Everywhere — Kettu/Bunny Plugin
 * 
 * Set custom nicknames for any user that persist across all servers and DMs.
 * Unlike Discord's native nicknames (which are server-specific), these
 * nicknames follow the user everywhere you see them.
 *
 * Created by: [Your Name]
 */

import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { showInputAlert } from "@vendetta/ui/alerts";

const { Text } = RN;

// Storage structure: { "userId": "Custom Nickname" }
if (!storage.nicknames) {
    storage.nicknames = {};
}

let unpatches: Function[] = [];

/**
 * Get the custom nickname for a user ID
 */
function getNickname(userId: string): string | null {
    return storage.nicknames[userId] || null;
}

/**
 * Set a custom nickname for a user ID
 */
function setNickname(userId: string, nickname: string) {
    if (!nickname || nickname.trim() === "") {
        delete storage.nicknames[userId];
    } else {
        storage.nicknames[userId] = nickname.trim();
    }
}

/**
 * Show a prompt to set/edit a nickname
 */
function promptSetNickname(userId: string, currentName: string) {
    const currentNickname = getNickname(userId);
    
    showInputAlert({
        title: "Set Custom Nickname",
        placeholder: currentName,
        initialValue: currentNickname || "",
        confirmText: "Save",
        cancelText: "Cancel",
        onConfirm: (value: string) => {
            setNickname(userId, value);
            
            // Show toast confirmation
            const { showToast } = findByProps("showToast") || {};
            if (showToast) {
                if (value.trim()) {
                    showToast(`Nickname set to "${value}"`, 1);
                } else {
                    showToast("Nickname removed", 1);
                }
            }
        }
    });
}

/**
 * Patch username displays to show custom nicknames
 */
function patchUsernames() {
    // Common username component names in Discord mobile
    const usernameComponents = [
        "Username",
        "UserName", 
        "DisplayName",
        "MemberListItem",
        "MessageHeader",
        "UserMention"
    ];

    for (const componentName of usernameComponents) {
        try {
            const component = findByName(componentName, false);
            if (component) {
                const unpatch = after("type", component, (args, res) => {
                    try {
                        const props = args[0];
                        const userId = props?.user?.id || props?.userId || props?.author?.id;
                        
                        if (userId) {
                            const customNick = getNickname(userId);
                            if (customNick && res?.props) {
                                // Replace the username text with our custom nickname
                                if (typeof res.props.children === "string") {
                                    res.props.children = customNick;
                                } else if (res.props.children?.props?.children) {
                                    if (typeof res.props.children.props.children === "string") {
                                        res.props.children.props.children = customNick;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // Silently fail to avoid spam
                    }
                    return res;
                });
                unpatches.push(unpatch);
                console.log(`[NicknamesEverywhere] Patched ${componentName}`);
            }
        } catch {}
    }
}

/**
 * Patch the getName function used throughout Discord
 */
function patchGetName() {
    try {
        // Discord has a user utilities module with getName/getDisplayName functions
        const UserUtils = findByProps("getUser", "getCurrentUser", false);
        
        if (UserUtils?.getName) {
            const unpatch = after("getName", UserUtils, (args, originalName) => {
                const user = args[0];
                if (user?.id) {
                    const customNick = getNickname(user.id);
                    if (customNick) {
                        return customNick;
                    }
                }
                return originalName;
            });
            unpatches.push(unpatch);
            console.log("[NicknamesEverywhere] Patched UserUtils.getName");
        }

        if (UserUtils?.getDisplayName) {
            const unpatch = after("getDisplayName", UserUtils, (args, originalName) => {
                const user = args[0];
                if (user?.id) {
                    const customNick = getNickname(user.id);
                    if (customNick) {
                        return customNick;
                    }
                }
                return originalName;
            });
            unpatches.push(unpatch);
            console.log("[NicknamesEverywhere] Patched UserUtils.getDisplayName");
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching UserUtils:", e);
    }
}

/**
 * Patch the GuildMemberStore to override nicknames
 */
function patchMemberStore() {
    try {
        const GuildMemberStore = findByProps("getNick", "getMember", false);
        
        if (GuildMemberStore?.getNick) {
            const unpatch = after("getNick", GuildMemberStore, (args, originalNick) => {
                const [guildId, userId] = args;
                if (userId) {
                    const customNick = getNickname(userId);
                    if (customNick) {
                        return customNick;
                    }
                }
                return originalNick;
            });
            unpatches.push(unpatch);
            console.log("[NicknamesEverywhere] Patched GuildMemberStore.getNick");
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching GuildMemberStore:", e);
    }
}

/**
 * Add "Set Nickname" option to user context menus (long-press)
 */
function patchUserContextMenu() {
    try {
        // Find the module that builds user action sheet options
        const UserActions = findByProps("openUserContextMenu", false) || 
                           findByProps("showUserProfileActionSheet", false);
        
        if (!UserActions) {
            console.warn("[NicknamesEverywhere] Could not find UserActions module");
            return;
        }

        // Try to find the function that builds the action sheet
        const buildFunction = UserActions.getUserActions || 
                             UserActions.buildActions ||
                             UserActions.default;

        if (buildFunction) {
            const unpatch = after("getUserActions", UserActions, (args, actions) => {
                const user = args[0]?.user || args[0];
                
                if (user?.id && Array.isArray(actions)) {
                    const currentNickname = getNickname(user.id);
                    
                    actions.push({
                        key: "set-nickname",
                        label: currentNickname ? "✏️ Edit Nickname" : "✏️ Set Nickname",
                        onPress: () => {
                            const displayName = user.globalName || user.username || "User";
                            promptSetNickname(user.id, displayName);
                        }
                    });
                    
                    // Add remove option if nickname exists
                    if (currentNickname) {
                        actions.push({
                            key: "remove-nickname",
                            label: "🗑️ Remove Nickname",
                            onPress: () => {
                                setNickname(user.id, "");
                                const { showToast } = findByProps("showToast") || {};
                                if (showToast) {
                                    showToast("Nickname removed", 1);
                                }
                            }
                        });
                    }
                }
                
                return actions;
            });
            unpatches.push(unpatch);
            console.log("[NicknamesEverywhere] Patched user context menu");
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching user context menu:", e);
    }
}

/**
 * Patch message components to show nicknames
 */
function patchMessages() {
    try {
        // Find message-related components
        const MessageHeader = findByName("MessageHeader", false) || 
                             findByProps("MessageHeader", false)?.MessageHeader;
        
        if (MessageHeader) {
            const target = MessageHeader.default || MessageHeader;
            const unpatch = after("type", target, (args, res) => {
                try {
                    const props = args[0];
                    const userId = props?.message?.author?.id || props?.author?.id;
                    
                    if (userId && res?.props) {
                        const customNick = getNickname(userId);
                        if (customNick) {
                            // Walk the tree to find username text nodes
                            const replaceUsername = (node: any): any => {
                                if (!node) return node;
                                
                                if (typeof node === 'string') {
                                    // Check if this string is the username
                                    const username = props?.message?.author?.username || 
                                                   props?.author?.username;
                                    if (username && node.includes(username)) {
                                        return node.replace(username, customNick);
                                    }
                                }
                                
                                if (node?.props?.children) {
                                    if (Array.isArray(node.props.children)) {
                                        node.props.children = node.props.children.map(replaceUsername);
                                    } else {
                                        node.props.children = replaceUsername(node.props.children);
                                    }
                                }
                                
                                return node;
                            };
                            
                            res = replaceUsername(res);
                        }
                    }
                } catch (e) {
                    // Silently fail
                }
                return res;
            });
            unpatches.push(unpatch);
            console.log("[NicknamesEverywhere] Patched MessageHeader");
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching messages:", e);
    }
}

export default {
    onLoad: () => {
        try {
            patchGetName();
            patchMemberStore();
            patchUsernames();
            patchMessages();
            patchUserContextMenu();
            
            console.log(`[NicknamesEverywhere] Loaded with ${Object.keys(storage.nicknames).length} saved nicknames`);
            console.log(`[NicknamesEverywhere] Applied ${unpatches.length} patches`);
        } catch (e) {
            console.error("[NicknamesEverywhere] Failed to load:", e);
        }
    },

    onUnload: () => {
        unpatches.forEach(unpatch => {
            try {
                unpatch();
            } catch (e) {
                console.error("[NicknamesEverywhere] Error during unpatch:", e);
            }
        });
        unpatches = [];
        console.log("[NicknamesEverywhere] Unloaded");
    }
};
