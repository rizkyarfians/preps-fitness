CREATE TABLE `plan` (
	`id` varchar(36) NOT NULL,
	`gym_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`draft` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`latest_version_id` varchar(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `plan_gym_id_branch_id_id_pk` PRIMARY KEY(`gym_id`,`branch_id`,`id`)
);
--> statement-breakpoint
ALTER TABLE `plan` ADD CONSTRAINT `plan_branch_fk` FOREIGN KEY (`gym_id`,`branch_id`) REFERENCES `branch`(`gym_id`,`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Backfill the latest immutable snapshot for each existing branch/plan.
INSERT INTO `plan` (`id`,`gym_id`,`branch_id`,`draft`,`version`,`status`,`latest_version_id`,`created_at`,`updated_at`)
SELECT p.`plan_id`,p.`gym_id`,p.`branch_id`,JSON_REMOVE(p.`snapshot`,'$.id','$.planId','$.branchId','$.version','$.publishedAt'),1,'published',p.`id`,p.`created_at`,p.`created_at`
FROM `plan_version` p
WHERE NOT EXISTS (SELECT 1 FROM `plan_version` newer WHERE newer.`gym_id`=p.`gym_id` AND newer.`branch_id`=p.`branch_id` AND newer.`plan_id`=p.`plan_id` AND newer.`version`>p.`version`);
