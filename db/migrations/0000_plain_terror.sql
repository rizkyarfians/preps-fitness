CREATE TABLE `auth_account` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_account_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_provider_identity` UNIQUE(`provider_id`,`account_id`)
);
--> statement-breakpoint
CREATE TABLE `branch` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `branch_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_gym_id` UNIQUE(`gym_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `branch_access` (
	`gym_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` enum('owner','admin','pt','member') NOT NULL,
	CONSTRAINT `branch_access_gym_id_branch_id_user_id_role_pk` PRIMARY KEY(`gym_id`,`branch_id`,`user_id`,`role`)
);
--> statement-breakpoint
CREATE TABLE `gym` (
	`id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gym_user` (
	`gym_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `gym_user_gym_id_user_id_pk` PRIMARY KEY(`gym_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `member_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_gym_user` UNIQUE(`gym_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` varchar(36) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_session_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_user_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` varchar(36) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `auth_account` ADD CONSTRAINT `auth_account_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch` ADD CONSTRAINT `branch_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_access` ADD CONSTRAINT `branch_access_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branch_access` ADD CONSTRAINT `branch_access_gym_id_user_id_gym_user_gym_id_user_id_fk` FOREIGN KEY (`gym_id`,`user_id`) REFERENCES `gym_user`(`gym_id`,`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gym_user` ADD CONSTRAINT `gym_user_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gym_user` ADD CONSTRAINT `gym_user_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_gym_id_user_id_gym_user_gym_id_user_id_fk` FOREIGN KEY (`gym_id`,`user_id`) REFERENCES `gym_user`(`gym_id`,`user_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_session` ADD CONSTRAINT `auth_session_user_id_auth_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `auth_verification` (`identifier`);