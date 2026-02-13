/**
 * Nicknames Everywhere — Kettu/Bunny Plugin
 * 
 * Set custom nicknames for any user that persist across all servers and DMs.
 * Unlike Discord's native nicknames (which are server-specific), these
 * nicknames follow the user everywhere you see them.
 *
 * Features:
 * - Set nicknames via long-press menu
 * - Filter users by ID, username, or tag
 * - Search and manage all nicknames in settings
 * - Export/import nickname lists
 * - Optional nickname prefix/suffix
 * - Whitelist/Blacklist modes
 *
 * Created by: [Your Name]
 */

import { findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { showInputAlert, showConfirmationAlert } from "@vendetta/ui/alerts";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, View, Text, TouchableOpacity, TextInput } = RN;
const { FormRow, FormSwitch, FormInput, FormDivider, FormSection, FormText } = Forms;

// Initialize storage
if (!storage.nicknames) storage.nicknames = {};
if (!storage.settings) {
    storage.settings = {
        enabled: true,
        showPrefix: false,
        prefix: "[",
        suffix: "]",
        filterMode: "none", // "none", "whitelist", "blacklist"
        filteredUsers: [], // Array of user IDs to filter
        overrideServerNicks: true,
    };
}

let unpatches: Function[] = [];

/**
 * Get the custom nickname for a user ID
 */
function getNickname(userId: string): string | null {
    if (!storage.settings.enabled) return null;
    
    // Check filter mode
    const { filterMode, filteredUsers } = storage.settings;
    
    if (filterMode === "blacklist" && filteredUsers.includes(userId)) {
        return null; // Don't show nickname for blacklisted users
    }
    
    if (filterMode === "whitelist" && !filteredUsers.includes(userId)) {
        return null; // Only show nicknames for whitelisted users
    }
    
    const nickname = storage.nicknames[userId];
    if (!nickname) return null;
    
    // Apply prefix/suffix if enabled
    if (storage.settings.showPrefix) {
        return `${storage.settings.prefix}${nickname}${storage.settings.suffix}`;
    }
    
    return nickname;
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
 * Add user to filter list
 */
function addToFilter(userId: string) {
    if (!storage.settings.filteredUsers.includes(userId)) {
        storage.settings.filteredUsers.push(userId);
    }
}

/**
 * Remove user from filter list
 */
function removeFromFilter(userId: string) {
    storage.settings.filteredUsers = storage.settings.filteredUsers.filter(id => id !== userId);
}

/**
 * Check if user is in filter list
 */
function isFiltered(userId: string): boolean {
    return storage.settings.filteredUsers.includes(userId);
}

/**
 * Show a prompt to set/edit a nickname
 */
function promptSetNickname(userId: string, currentName: string) {
    const currentNickname = storage.nicknames[userId] || "";
    
    showInputAlert({
        title: "Set Custom Nickname",
        placeholder: currentName,
        initialValue: currentNickname,
        confirmText: "Save",
        cancelText: "Cancel",
        onConfirm: (value: string) => {
            setNickname(userId, value);
            
            const { showToast } = findByProps("showToast") || {};
            if (showToast) {
                if (value.trim()) {
                    showToast(`✅ Nickname set to "${value}"`, 1);
                } else {
                    showToast("✅ Nickname removed", 1);
                }
            }
        }
    });
}

/**
 * Patch username displays to show custom nicknames
 */
function patchUsernames() {
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
                                if (typeof res.props.children === "string") {
                                    res.props.children = customNick;
                                } else if (res.props.children?.props?.children) {
                                    if (typeof res.props.children.props.children === "string") {
                                        res.props.children.props.children = customNick;
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                    return res;
                });
                unpatches.push(unpatch);
            }
        } catch {}
    }
}

/**
 * Patch the getName function used throughout Discord
 */
function patchGetName() {
    try {
        const UserUtils = findByProps("getUser", "getCurrentUser", false);
        
        if (UserUtils?.getName) {
            const unpatch = after("getName", UserUtils, (args, originalName) => {
                const user = args[0];
                if (user?.id) {
                    const customNick = getNickname(user.id);
                    if (customNick) return customNick;
                }
                return originalName;
            });
            unpatches.push(unpatch);
        }

        if (UserUtils?.getDisplayName) {
            const unpatch = after("getDisplayName", UserUtils, (args, originalName) => {
                const user = args[0];
                if (user?.id) {
                    const customNick = getNickname(user.id);
                    if (customNick) return customNick;
                }
                return originalName;
            });
            unpatches.push(unpatch);
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
                if (userId && storage.settings.overrideServerNicks) {
                    const customNick = getNickname(userId);
                    if (customNick) return customNick;
                }
                return originalNick;
            });
            unpatches.push(unpatch);
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching GuildMemberStore:", e);
    }
}

/**
 * Add options to user context menus
 */
function patchUserContextMenu() {
    try {
        const UserActions = findByProps("openUserContextMenu", false) || 
                           findByProps("showUserProfileActionSheet", false);
        
        if (!UserActions) return;

        const buildFunction = UserActions.getUserActions || 
                             UserActions.buildActions ||
                             UserActions.default;

        if (buildFunction) {
            const unpatch = after("getUserActions", UserActions, (args, actions) => {
                const user = args[0]?.user || args[0];
                
                if (user?.id && Array.isArray(actions)) {
                    const currentNickname = storage.nicknames[user.id];
                    const isUserFiltered = isFiltered(user.id);
                    const { filterMode } = storage.settings;
                    
                    // Set/Edit Nickname
                    actions.push({
                        key: "set-nickname",
                        label: currentNickname ? "✏️ Edit Nickname" : "✏️ Set Nickname",
                        onPress: () => {
                            const displayName = user.globalName || user.username || "User";
                            promptSetNickname(user.id, displayName);
                        }
                    });
                    
                    // Remove Nickname
                    if (currentNickname) {
                        actions.push({
                            key: "remove-nickname",
                            label: "🗑️ Remove Nickname",
                            onPress: () => {
                                setNickname(user.id, "");
                                const { showToast } = findByProps("showToast") || {};
                                if (showToast) showToast("✅ Nickname removed", 1);
                            }
                        });
                    }
                    
                    // Filter options
                    if (filterMode === "whitelist") {
                        if (isUserFiltered) {
                            actions.push({
                                key: "remove-whitelist",
                                label: "➖ Remove from Whitelist",
                                onPress: () => {
                                    removeFromFilter(user.id);
                                    const { showToast } = findByProps("showToast") || {};
                                    if (showToast) showToast("✅ Removed from whitelist", 1);
                                }
                            });
                        } else {
                            actions.push({
                                key: "add-whitelist",
                                label: "➕ Add to Whitelist",
                                onPress: () => {
                                    addToFilter(user.id);
                                    const { showToast } = findByProps("showToast") || {};
                                    if (showToast) showToast("✅ Added to whitelist", 1);
                                }
                            });
                        }
                    } else if (filterMode === "blacklist") {
                        if (isUserFiltered) {
                            actions.push({
                                key: "remove-blacklist",
                                label: "➖ Remove from Blacklist",
                                onPress: () => {
                                    removeFromFilter(user.id);
                                    const { showToast } = findByProps("showToast") || {};
                                    if (showToast) showToast("✅ Removed from blacklist", 1);
                                }
                            });
                        } else {
                            actions.push({
                                key: "add-blacklist",
                                label: "➕ Add to Blacklist",
                                onPress: () => {
                                    addToFilter(user.id);
                                    const { showToast } = findByProps("showToast") || {};
                                    if (showToast) showToast("✅ Added to blacklist", 1);
                                }
                            });
                        }
                    }
                }
                
                return actions;
            });
            unpatches.push(unpatch);
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
                            const replaceUsername = (node: any): any => {
                                if (!node) return node;
                                
                                if (typeof node === 'string') {
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
                } catch (e) {}
                return res;
            });
            unpatches.push(unpatch);
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching messages:", e);
    }
}

/**
 * Settings Page Component
 */
function SettingsPage() {
    useProxy(storage);
    const UserStore = findByStoreName("UserStore");
    const [searchQuery, setSearchQuery] = React.useState("");

    // Get user info for display
    const getUserInfo = (userId: string) => {
        try {
            const user = UserStore?.getUser(userId);
            return user ? `${user.username}#${user.discriminator}` : userId;
        } catch {
            return userId;
        }
    };

    // Filter nicknames by search
    const filteredNicknames = Object.entries(storage.nicknames).filter(([userId, nickname]) => {
        if (!searchQuery) return true;
        const userInfo = getUserInfo(userId).toLowerCase();
        const nickLower = (nickname as string).toLowerCase();
        const queryLower = searchQuery.toLowerCase();
        return userInfo.includes(queryLower) || nickLower.includes(queryLower) || userId.includes(queryLower);
    });

    return (
        <ScrollView style={{ flex: 1 }}>
            <FormSection title="General Settings">
                <FormRow
                    label="Enable Nicknames"
                    subLabel="Toggle all nickname functionality on/off"
                    trailing={
                        <FormSwitch
                            value={storage.settings.enabled}
                            onValueChange={(v: boolean) => storage.settings.enabled = v}
                        />
                    }
                />
                
                <FormRow
                    label="Override Server Nicknames"
                    subLabel="Show custom nicknames instead of server-specific ones"
                    trailing={
                        <FormSwitch
                            value={storage.settings.overrideServerNicks}
                            onValueChange={(v: boolean) => storage.settings.overrideServerNicks = v}
                        />
                    }
                />
            </FormSection>

            <FormDivider />

            <FormSection title="Display Options">
                <FormRow
                    label="Show Prefix/Suffix"
                    subLabel="Add decorative text around nicknames (e.g., [Nick] or ⭐Nick⭐)"
                    trailing={
                        <FormSwitch
                            value={storage.settings.showPrefix}
                            onValueChange={(v: boolean) => storage.settings.showPrefix = v}
                        />
                    }
                />
                
                {storage.settings.showPrefix && (
                    <>
                        <FormInput
                            label="Prefix"
                            placeholder="["
                            value={storage.settings.prefix}
                            onChange={(v: string) => storage.settings.prefix = v}
                        />
                        
                        <FormInput
                            label="Suffix"
                            placeholder="]"
                            value={storage.settings.suffix}
                            onChange={(v: string) => storage.settings.suffix = v}
                        />
                        
                        <View style={{ padding: 16, backgroundColor: "#2b2d31", marginHorizontal: 16, marginTop: 8, borderRadius: 8 }}>
                            <Text style={{ color: "#b5bac1", fontSize: 13 }}>
                                Preview: {storage.settings.prefix}YourNickname{storage.settings.suffix}
                            </Text>
                        </View>
                    </>
                )}
            </FormSection>

            <FormDivider />

            <FormSection title="Filter Mode">
                <FormText>
                    Control which users' nicknames are shown. Use the long-press menu on users to add/remove them from the list.
                </FormText>
                
                <FormRow
                    label="None"
                    subLabel="Show all nicknames (default)"
                    trailing={
                        <FormSwitch
                            value={storage.settings.filterMode === "none"}
                            onValueChange={() => storage.settings.filterMode = "none"}
                        />
                    }
                />
                
                <FormRow
                    label="Whitelist"
                    subLabel="Only show nicknames for selected users"
                    trailing={
                        <FormSwitch
                            value={storage.settings.filterMode === "whitelist"}
                            onValueChange={() => storage.settings.filterMode = "whitelist"}
                        />
                    }
                />
                
                <FormRow
                    label="Blacklist"
                    subLabel="Hide nicknames for selected users"
                    trailing={
                        <FormSwitch
                            value={storage.settings.filterMode === "blacklist"}
                            onValueChange={() => storage.settings.filterMode = "blacklist"}
                        />
                    }
                />
                
                {storage.settings.filterMode !== "none" && (
                    <View style={{ padding: 16 }}>
                        <Text style={{ color: "#b5bac1", marginBottom: 8 }}>
                            {storage.settings.filteredUsers.length} users in {storage.settings.filterMode}
                        </Text>
                        <TouchableOpacity
                            style={{
                                backgroundColor: "#ed4245",
                                padding: 12,
                                borderRadius: 8,
                                alignItems: "center"
                            }}
                            onPress={() => {
                                showConfirmationAlert({
                                    title: "Clear Filter List?",
                                    content: `Remove all ${storage.settings.filteredUsers.length} users from the ${storage.settings.filterMode}?`,
                                    confirmText: "Clear",
                                    cancelText: "Cancel",
                                    confirmColor: "red",
                                    onConfirm: () => {
                                        storage.settings.filteredUsers = [];
                                        const { showToast } = findByProps("showToast") || {};
                                        if (showToast) showToast("✅ Filter list cleared", 1);
                                    }
                                });
                            }}
                        >
                            <Text style={{ color: "#fff", fontWeight: "bold" }}>Clear {storage.settings.filterMode}</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </FormSection>

            <FormDivider />

            <FormSection title={`Saved Nicknames (${Object.keys(storage.nicknames).length})`}>
                <FormText>
                    Search and manage all your saved nicknames. You can also set nicknames by long-pressing on any user.
                </FormText>
                
                <View style={{ padding: 16 }}>
                    <TextInput
                        placeholder="Search by username, nickname, or user ID..."
                        placeholderTextColor="#666"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        style={{
                            backgroundColor: "#1e1f22",
                            color: "#fff",
                            padding: 12,
                            borderRadius: 8,
                            marginBottom: 12
                        }}
                    />
                    
                    {filteredNicknames.length === 0 ? (
                        <View style={{ padding: 20, alignItems: "center" }}>
                            <Text style={{ color: "#888", textAlign: "center", fontSize: 14 }}>
                                {searchQuery ? "No nicknames found matching your search" : "No nicknames saved yet"}
                            </Text>
                            <Text style={{ color: "#666", textAlign: "center", fontSize: 12, marginTop: 8 }}>
                                {!searchQuery && "Long-press any user and select 'Set Nickname' to get started"}
                            </Text>
                        </View>
                    ) : (
                        filteredNicknames.map(([userId, nickname]) => (
                            <View
                                key={userId}
                                style={{
                                    backgroundColor: "#2b2d31",
                                    padding: 12,
                                    borderRadius: 8,
                                    marginBottom: 8
                                }}
                            >
                                <Text style={{ color: "#fff", fontWeight: "bold", marginBottom: 4 }}>
                                    {nickname as string}
                                </Text>
                                <Text style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
                                    {getUserInfo(userId)}
                                </Text>
                                <View style={{ flexDirection: "row", gap: 8 }}>
                                    <TouchableOpacity
                                        style={{
                                            backgroundColor: "#5865f2",
                                            padding: 8,
                                            borderRadius: 6,
                                            flex: 1
                                        }}
                                        onPress={() => promptSetNickname(userId, getUserInfo(userId))}
                                    >
                                        <Text style={{ color: "#fff", textAlign: "center", fontSize: 12, fontWeight: "600" }}>Edit</Text>
                                    </TouchableOpacity>
                                    
                                    <TouchableOpacity
                                        style={{
                                            backgroundColor: "#ed4245",
                                            padding: 8,
                                            borderRadius: 6,
                                            flex: 1
                                        }}
                                        onPress={() => {
                                            setNickname(userId, "");
                                            const { showToast } = findByProps("showToast") || {};
                                            if (showToast) showToast("✅ Nickname removed", 1);
                                        }}
                                    >
                                        <Text style={{ color: "#fff", textAlign: "center", fontSize: 12, fontWeight: "600" }}>Delete</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))
                    )}
                </View>
            </FormSection>

            <FormDivider />

            <FormSection title="Data Management">
                <FormText>
                    Export your nicknames to back them up, or import a previously saved list. Data is stored in JSON format.
                </FormText>
                
                <FormRow
                    label="Export Nicknames"
                    subLabel="Copy all nicknames as JSON to clipboard"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_download_24px")} />}
                    onPress={() => {
                        const json = JSON.stringify(storage.nicknames, null, 2);
                        RN.Clipboard?.setString(json);
                        const { showToast } = findByProps("showToast") || {};
                        if (showToast) showToast(`✅ ${Object.keys(storage.nicknames).length} nicknames copied to clipboard`, 1);
                    }}
                />
                
                <FormRow
                    label="Import Nicknames"
                    subLabel="Paste JSON from clipboard to import"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_upload_24px")} />}
                    onPress={async () => {
                        try {
                            const clipboard = await RN.Clipboard?.getString();
                            if (!clipboard) {
                                const { showToast } = findByProps("showToast") || {};
                                if (showToast) showToast("❌ Clipboard is empty", 2);
                                return;
                            }
                            
                            const parsed = JSON.parse(clipboard);
                            const count = Object.keys(parsed).length;
                            Object.assign(storage.nicknames, parsed);
                            const { showToast } = findByProps("showToast") || {};
                            if (showToast) showToast(`✅ Imported ${count} nicknames`, 1);
                        } catch (e) {
                            const { showToast } = findByProps("showToast") || {};
                            if (showToast) showToast("❌ Invalid JSON format", 2);
                        }
                    }}
                />
                
                <FormRow
                    label="Clear All Nicknames"
                    subLabel="⚠️ Permanently delete all saved nicknames"
                    leading={<FormRow.Icon source={getAssetIDByName("ic_message_delete")} />}
                    onPress={() => {
                        showConfirmationAlert({
                            title: "Clear All Nicknames?",
                            content: `This will permanently delete all ${Object.keys(storage.nicknames).length} saved nicknames. This action cannot be undone.`,
                            confirmText: "Delete All",
                            cancelText: "Cancel",
                            confirmColor: "red",
                            onConfirm: () => {
                                const count = Object.keys(storage.nicknames).length;
                                storage.nicknames = {};
                                const { showToast } = findByProps("showToast") || {};
                                if (showToast) showToast(`✅ Cleared ${count} nicknames`, 1);
                            }
                        });
                    }}
                />
            </FormSection>

            <FormDivider />

            <View style={{ padding: 16, marginBottom: 20 }}>
                <Text style={{ color: "#b5bac1", fontSize: 12, textAlign: "center", lineHeight: 18 }}>
                    Nicknames Everywhere v1.0{'\n'}
                    Custom nicknames that follow users across all servers and DMs
                </Text>
            </View>
        </ScrollView>
    );
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
    },
    
    settings: SettingsPage
};
