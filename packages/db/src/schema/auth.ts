import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { defineRelations, sql } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@zhiye/utils/string";

function lower<T extends AnyPgColumn>(column: T): SQL<T> {
	return sql`lower(${column})`;
}

export const user = pg.pgTable(
	"user",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		image: pg.text("image"),
		name: pg.text("name").notNull(),
		email: pg.text("email").notNull().unique(),
		emailVerified: pg.boolean("email_verified").notNull().default(false),
		username: pg.text("username").notNull().unique(),
		displayUsername: pg.text("display_username").notNull().unique(),
		/** Where the user's times are shown (Settings → Preferences); an IANA name. */
		timezone: pg.text("timezone").notNull().default("UTC"),
		/** The interface language the account last used, for account emails; null until the app reports one. */
		locale: pg.text("locale"),
		lastActiveAt: pg.timestamp("last_active_at", { withTimezone: true }),
		role: pg.text("role").default("user"),
		banned: pg.boolean("banned").default(false),
		banReason: pg.text("ban_reason"),
		banExpires: pg.timestamp("ban_expires", {
			precision: 6,
			withTimezone: true,
		}),
		isAnonymous: pg.boolean("is_anonymous").notNull().default(false),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.createdAt.asc()), pg.uniqueIndex("user_email_lower_unique_idx").on(lower(t.email))],
);

/**
 * Usernames people stopped using (renamed or deleted accounts). Old public links point at them, so for a while only
 * their previous owner can take one again. A trigger in the migration records them on every rename or deletion.
 */
export const releasedUsername = pg.pgTable("released_username", {
	username: pg.text("username").primaryKey(),
	/** The account that released it, or null when that account was deleted. */
	userId: pg.text("user_id"),
	releasedAt: pg.timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pg.pgTable(
	"session",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		token: pg.text("token").notNull().unique(),
		ipAddress: pg.text("ip_address"),
		userAgent: pg.text("user_agent"),
		impersonatedBy: pg.text("impersonated_by"),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		pg.index().on(t.token, t.userId),
		pg.index().on(t.expiresAt),
		// Sessions are listed and deleted by user, and a user delete cascades to them.
		pg.index().on(t.userId),
	],
);

export const account = pg.pgTable(
	"account",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		accountId: pg.text("account_id").notNull(),
		providerId: pg.text("provider_id").notNull().default("credential"),
		// Better Auth 1.7.0–1.7.2 wrote this identity namespace. Version 1.7.3
		// returned to (providerId, accountId), so keep migrated values without
		// requiring the field on new account inserts.
		issuer: pg.text("issuer"),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		scope: pg.text("scope"),
		idToken: pg.text("id_token"),
		password: pg.text("password"),
		accessToken: pg.text("access_token"),
		refreshToken: pg.text("refresh_token"),
		accessTokenExpiresAt: pg.timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: pg.timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	// Better Auth finds an account by provider and provider account on every social sign-in (#3593).
	(t) => [
		pg.index().on(t.userId),
		pg.uniqueIndex("account_provider_id_account_id_unique").on(t.providerId, t.accountId),
	],
);

// Better Auth joins sessions to users, users to accounts, and provider accounts to their owners.
export const authRelations = defineRelations({ user, session, account }, (r) => ({
	user: {
		accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
		sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
	},
	session: {
		user: r.one.user({ from: r.session.userId, to: r.user.id }),
	},
	account: {
		user: r.one.user({ from: r.account.userId, to: r.user.id }),
	},
}));

export const verification = pg.pgTable(
	"verification",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		identifier: pg.text("identifier").notNull().unique(),
		value: pg.text("value").notNull(),
		expiresAt: pg.timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.identifier)],
);

export const passkey = pg.pgTable(
	"passkey",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		name: pg.text("name"),
		aaguid: pg.text("aaguid"),
		publicKey: pg.text("public_key").notNull(),
		credentialID: pg.text("credential_id").notNull(),
		counter: pg.integer("counter").notNull(),
		deviceType: pg.text("device_type").notNull(),
		backedUp: pg.boolean("backed_up").notNull().default(false),
		transports: pg.text("transports").notNull(),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.userId)],
);

export const jwks = pg.pgTable("jwks", {
	id: pg
		.text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => generateId()),
	publicKey: pg.text("public_key").notNull(),
	privateKey: pg.text("private_key").notNull(),
	createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	expiresAt: pg.timestamp("expires_at", { withTimezone: true }),
	// Better Auth 1.7 added `alg` and `crv` to the jwt plugin's jwks model. Both are optional to
	// the plugin, but the Drizzle adapter rejects a model whose columns it cannot find, so every
	// session verification throws until they exist. Existing rows keep NULL and stay valid.
	alg: pg.text("alg"),
	crv: pg.text("crv"),
});
