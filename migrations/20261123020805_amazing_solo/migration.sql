ALTER TABLE "agent_threads" DROP CONSTRAINT "agent_threads_cover_letter_id_cover_letter_id_fkey";--> statement-breakpoint
ALTER TABLE "application" DROP CONSTRAINT "application_cover_letter_id_cover_letter_id_fkey";--> statement-breakpoint
ALTER TABLE "application" DROP CONSTRAINT "application_QJaGmijrxJ0T_fkey";--> statement-breakpoint
ALTER TABLE "cover_letter_version" DROP CONSTRAINT "cover_letter_version_cover_letter_id_cover_letter_id_fkey";--> statement-breakpoint
DROP TABLE "cover_letter";--> statement-breakpoint
DROP TABLE "cover_letter_version";--> statement-breakpoint
DROP INDEX "agent_threads_cover_letter_id_index";--> statement-breakpoint
DROP INDEX "application_cover_letter_id_index";--> statement-breakpoint
DROP INDEX "application_sent_cover_letter_version_id_index";--> statement-breakpoint
ALTER TABLE "agent_threads" DROP COLUMN "cover_letter_id";--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "cover_letter_id";--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "sent_cover_letter_version_id";--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "cover_letter_url";--> statement-breakpoint
ALTER TABLE "application" DROP COLUMN "cover_letter_name";