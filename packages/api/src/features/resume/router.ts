import { crudRouter } from "./crud";
import { updatesRouter } from "./event-router";
import { tagsRouter } from "./tags";
import { versionsRouter } from "./versions";

export const resumeRouter = {
	tags: tagsRouter,
	updates: updatesRouter,

	list: crudRouter.list,
	getById: crudRouter.getById,
	create: crudRouter.create,
	import: crudRouter.import,
	update: crudRouter.update,
	patch: crudRouter.patch,
	setLocked: crudRouter.setLocked,
	duplicate: crudRouter.duplicate,
	delete: crudRouter.delete,
	listVersions: versionsRouter.listVersions,
	getVersion: versionsRouter.getVersion,
	createVersion: versionsRouter.createVersion,
	renameVersion: versionsRouter.renameVersion,
	deleteVersion: versionsRouter.deleteVersion,
	restoreVersion: versionsRouter.restoreVersion,
};
