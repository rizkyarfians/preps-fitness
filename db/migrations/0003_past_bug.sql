CREATE TABLE `candidate_check` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`identity_hash` varchar(64) NOT NULL,
	`candidates_hash` varchar(64) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	CONSTRAINT `candidate_check_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `member_branch` (
	`gym_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`member_id` varchar(36) NOT NULL,
	CONSTRAINT `member_branch_gym_id_branch_id_member_id_pk` PRIMARY KEY(`gym_id`,`branch_id`,`member_id`)
);
--> statement-breakpoint
CREATE TABLE `plan_version` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`selectable` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `plan_version_id` PRIMARY KEY(`id`),
	CONSTRAINT `plan_branch_version` UNIQUE(`gym_id`,`branch_id`,`plan_id`,`version`),
	CONSTRAINT `plan_scope` UNIQUE(`gym_id`,`branch_id`,`id`)
);
--> statement-breakpoint
CREATE TABLE `registration` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`member_id` varchar(36) NOT NULL,
	`new_member` boolean NOT NULL,
	`identity` json NOT NULL,
	`offer` json NOT NULL,
	`status` enum('draft','pending_review','needs_clarification','approved','rejected') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`created_by` varchar(36) NOT NULL,
	`history` json NOT NULL,
	`submissions` json NOT NULL,
	`duplicate_resolutions` json NOT NULL,
	`pending_member_id` varchar(36),
	`order_id` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `registration_id` PRIMARY KEY(`id`),
	CONSTRAINT `registration_scope` UNIQUE(`gym_id`,`id`),
	CONSTRAINT `registration_pending_member` UNIQUE(`gym_id`,`branch_id`,`pending_member_id`)
);
--> statement-breakpoint
CREATE TABLE `registration_order` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`registration_id` varchar(36) NOT NULL,
	`offer` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `registration_order_id` PRIMARY KEY(`id`),
	CONSTRAINT `registration_order_registration_id_unique` UNIQUE(`registration_id`)
);
--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_scope` UNIQUE(`gym_id`,`id`);--> statement-breakpoint
ALTER TABLE `candidate_check` ADD CONSTRAINT `candidate_check_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidate_check` ADD CONSTRAINT `candidate_check_actor_id_auth_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `auth_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidate_check` ADD CONSTRAINT `candidate_check_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_branch` ADD CONSTRAINT `member_branch_gym_id_member_id_member_gym_id_id_fk` FOREIGN KEY (`gym_id`,`member_id`) REFERENCES `member`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `member_branch` ADD CONSTRAINT `member_branch_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `plan_version` ADD CONSTRAINT `plan_version_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration` ADD CONSTRAINT `registration_created_by_auth_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `auth_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration` ADD CONSTRAINT `registration_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration` ADD CONSTRAINT `registration_gym_id_member_id_member_gym_id_id_fk` FOREIGN KEY (`gym_id`,`member_id`) REFERENCES `member`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration_order` ADD CONSTRAINT `registration_order_registration_fk` FOREIGN KEY (`gym_id`,`registration_id`) REFERENCES `registration`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `candidate_expiry` ON `candidate_check` (`expires_at`);--> statement-breakpoint
CREATE INDEX `registration_branch_list` ON `registration` (`gym_id`,`branch_id`,`created_at`,`id`);