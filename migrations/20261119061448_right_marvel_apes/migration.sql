DROP TABLE "custom_domain";--> statement-breakpoint
DROP TABLE "resume_slug_redirect";--> statement-breakpoint
DROP TABLE "resume_statistics";--> statement-breakpoint
DROP TABLE "resume_statistics_daily";--> statement-breakpoint
ALTER TABLE "resume" DROP CONSTRAINT "resume_slug_user_id_unique";--> statement-breakpoint
DROP INDEX "resume_is_public_slug_user_id_index";--> statement-breakpoint
DROP INDEX "resume_primary_unique";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "is_public";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "show_download_buttons";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "allow_word_download";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "show_in_search_engines";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "hide_contact_details";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "is_primary";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "password";--> statement-breakpoint
ALTER TABLE "resume" DROP COLUMN "auto_slug";