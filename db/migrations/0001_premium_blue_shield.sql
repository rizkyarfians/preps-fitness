CREATE TABLE `audit_event` (
	`id` varchar(36) NOT NULL,
	`command_id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`operation` varchar(100) NOT NULL,
	`resource_id` varchar(100) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_event_command_id_unique` UNIQUE(`command_id`)
);
--> statement-breakpoint
CREATE TABLE `command_receipt` (
	`scope_hash` varchar(64) NOT NULL,
	`command_id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`operation` varchar(100) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`status` enum('pending','completed') NOT NULL,
	`result` json,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `command_receipt_scope_hash` PRIMARY KEY(`scope_hash`),
	CONSTRAINT `command_receipt_command_id_unique` UNIQUE(`command_id`)
);
--> statement-breakpoint
CREATE TABLE `outbox_event` (
	`id` varchar(36) NOT NULL,
	`command_id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`resource_id` varchar(100) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`published_at` timestamp(3),
	CONSTRAINT `outbox_event_id` PRIMARY KEY(`id`),
	CONSTRAINT `outbox_command_type` UNIQUE(`command_id`,`event_type`)
);
--> statement-breakpoint
ALTER TABLE `audit_event` ADD CONSTRAINT `audit_event_command_id_command_receipt_command_id_fk` FOREIGN KEY (`command_id`) REFERENCES `command_receipt`(`command_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_event` ADD CONSTRAINT `audit_event_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_event` ADD CONSTRAINT `audit_event_actor_id_auth_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `auth_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `command_receipt` ADD CONSTRAINT `command_receipt_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `command_receipt` ADD CONSTRAINT `command_receipt_actor_id_auth_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `auth_user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `command_receipt` ADD CONSTRAINT `command_receipt_gym_id_branch_id_branch_gym_id_id_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `outbox_event_command_id_command_receipt_command_id_fk` FOREIGN KEY (`command_id`) REFERENCES `command_receipt`(`command_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outbox_event` ADD CONSTRAINT `outbox_event_gym_id_gym_id_fk` FOREIGN KEY (`gym_id`) REFERENCES `gym`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_gym_created` ON `audit_event` (`gym_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `receipt_gym_created` ON `command_receipt` (`gym_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbox_pending` ON `outbox_event` (`published_at`,`created_at`);