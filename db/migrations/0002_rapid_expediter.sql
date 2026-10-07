ALTER TABLE `member` MODIFY COLUMN `user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `member` ADD `full_name` varchar(200);--> statement-breakpoint
ALTER TABLE `member` ADD `phone` varchar(16);--> statement-breakpoint
ALTER TABLE `member` ADD `address` varchar(1000);--> statement-breakpoint
ALTER TABLE `member` ADD `birth_place` varchar(120);--> statement-breakpoint
ALTER TABLE `member` ADD `birth_date` date;--> statement-breakpoint
ALTER TABLE `member` ADD `email` varchar(254);--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;