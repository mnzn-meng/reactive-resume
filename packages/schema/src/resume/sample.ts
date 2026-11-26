import type { ResumeData } from "./data";
import { sectionDefaults } from "./default";

export const sampleResumeData: ResumeData = {
	picture: {
		hidden: false,
		fit: "cover",
		url: "/photos/sample-picture.jpg",
		size: 100,
		rotation: 0,
		aspectRatio: 1,
		borderRadius: 0,
		borderColor: "rgba(0, 0, 0, 0.5)",
		borderWidth: 0,
		shadowColor: "rgba(0, 0, 0, 0.5)",
		shadowWidth: 0,
	},
	basics: {
		name: "陈默",
		headline: "后端工程师｜高并发交易系统与稳定性",
		email: "chen.mo@example.com",
		phone: "138 0013 8000",
		location: "杭州",
		website: {
			url: "https://chenmo.dev",
			label: "chenmo.dev",
		},
		customFields: [
			{
				id: "019bef5a-0477-77e0-968b-5d0e2ecb34e3",
				icon: "github-logo",
				text: "github.com/chenmo-dev",
				link: "https://github.com/chenmo-dev",
			},
			{
				id: "019bef5a-93e4-7746-ad39-3a132360f823",
				icon: "article",
				text: "chenmo.dev/notes",
				link: "https://chenmo.dev/notes",
			},
		],
	},
	summary: {
		...sectionDefaults("article"),
		content:
			"<p><strong>六年后端开发经验</strong>，专注高并发交易系统与稳定性建设。主导订单中心重构与支付对账平台，支撑大促峰值 12 万 QPS；推动灰度发布与熔断降级落地，故障恢复时间从 30 分钟降到 5 分钟。熟悉 Go、Java 与 MySQL、Redis、Kafka，习惯在业务节奏与架构演进之间做取舍。</p>",
	},
	sections: {
		profiles: {
			...sectionDefaults("messenger-logo"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-3d42ddc9b4d8",
					hidden: false,
					icon: "github-logo",
					iconColor: "",
					network: "GitHub",
					username: "chenmo-dev",
					website: {
						url: "https://github.com/chenmo-dev",
						label: "github.com/chenmo-dev",
						inlineLink: false,
					},
				},
			],
		},
		projects: {
			...sectionDefaults("code-simple"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-4d2603fe2801",
					hidden: false,
					name: "订单中心重构",
					period: "2024 - 2025",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>把单体订单服务拆成下单、履约、售后三个域，用 Kafka 做最终一致的事件流；大促峰值从 3 万 QPS 提到 12 万，P99 从 480ms 降到 290ms，回滚窗口从小时级缩到分钟级。</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-524195dd7eff",
					hidden: false,
					name: "支付对账平台",
					period: "2020 - 2022",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>对接 6 家渠道的日终对账，把人工逐笔核对改成自动化差异比对与自动补单，每月节省约 120 人时，差错率从 0.08% 降到 0.003%。</p>",
				},
			],
		},
		experience: {
			...sectionDefaults("briefcase"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-46b4e2b5c9f1",
					hidden: false,
					company: "云集电商",
					position: "高级后端工程师",
					location: "杭州",
					period: "2021.07 - 至今",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li><p>负责订单与支付链路的架构演进，支撑大促峰值 12 万 QPS，全年核心链路可用性 99.99%</p></li><li><p>主导订单中心重构：按下单、履约、售后拆域，事件驱动替代同步调用，P99 延迟下降 40%</p></li><li><p>落地灰度发布、熔断降级与容量压测，故障平均恢复时间从 30 分钟降到 5 分钟</p></li><li><p>带 4 人小组，负责方案评审与值班机制，团队线上事故数同比下降一半</p></li></ul>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-4a7b2c6d8e02",
					hidden: false,
					company: "合信支付",
					position: "后端工程师",
					location: "上海",
					period: "2018.07 - 2021.06",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li><p>建设支付对账平台，覆盖 6 家渠道的日终对账与自动补单，每月节省约 120 人时</p></li><li><p>用 Redis 与本地缓存改造热点账户查询，接口 P99 从 120ms 降到 25ms</p></li><li><p>补齐链路的幂等与重试设计，重复扣款类客诉从月均 6 起降到 0</p></li></ul>",
				},
			],
		},
		education: {
			...sectionDefaults("graduation-cap"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-5b8c3d9e1f03",
					hidden: false,
					school: "浙江大学",
					degree: "硕士",
					area: "计算机科学与技术",
					grade: "GPA 3.9/4.0（专业前 5%）",
					location: "杭州",
					period: "2015.09 - 2018.06",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description:
						"<p>主修课程：分布式系统、数据库系统实现、操作系统、编译原理。研究方向为分布式事务与共识算法。</p>",
				},
			],
		},
		skills: {
			...sectionDefaults("compass-tool"),
			layout: "default",
			keywordLayout: "inline",
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-607d1a4b5c04",
					hidden: false,
					icon: "compass-tool",
					iconColor: "",
					name: "语言与框架",
					proficiency: "熟练",
					level: 5,
					keywords: ["Go", "Java", "SQL", "gRPC"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-6574ab6814bd",
					hidden: false,
					icon: "brain",
					iconColor: "",
					name: "中间件与基础设施",
					proficiency: "熟练",
					level: 4,
					keywords: ["MySQL", "Redis", "Kafka", "Kubernetes"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-6a8e22bec684",
					hidden: false,
					icon: "chart-line-up",
					iconColor: "",
					name: "稳定性建设",
					proficiency: "熟练",
					level: 4,
					keywords: ["压测", "熔断降级", "灰度发布", "可观测性"],
				},
			],
		},
		languages: {
			...sectionDefaults("translate"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-73807ccc48b5",
					hidden: false,
					language: "中文",
					fluency: "母语",
					level: 5,
				},
				{
					id: "019bef5a-93e4-7746-ad39-768670459358",
					hidden: false,
					language: "英语",
					fluency: "CET-6 604，可技术沟通",
					level: 4,
				},
			],
		},
		interests: {
			...sectionDefaults("football"),
			hidden: true,
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-7821b4de95f7",
					hidden: false,
					icon: "football",
					iconColor: "",
					name: "耐力跑",
					keywords: ["半马", "每周 30 公里"],
				},
				{
					id: "019bef5a-93e4-7746-ad39-7c64c1a607d3",
					hidden: false,
					icon: "book-open",
					iconColor: "",
					name: "技术写作",
					keywords: ["架构笔记", "源码分析"],
				},
			],
		},
		awards: {
			...sectionDefaults("trophy"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-8a8bb9fbe182",
					hidden: false,
					title: "国家奖学金",
					awarder: "教育部",
					date: "2017",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "<p>研究生阶段综合排名前 3%，全校每年约 1% 的研究生获得。</p>",
				},
				{
					id: "019bef5a-93e4-7746-ad39-8dd81379c7c9",
					hidden: false,
					title: "全国大学生数学建模竞赛 省一等奖",
					awarder: "中国工业与应用数学学会",
					date: "2016",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "<p>负责模型设计与编程实现，赛题为城市交通流量预测。</p>",
				},
			],
		},
		certifications: {
			...sectionDefaults("certificate"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-91fe8a4dfea6",
					hidden: false,
					title: "软件设计师（中级）",
					issuer: "全国计算机技术与软件专业技术资格（水平）考试",
					date: "2017",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "",
				},
				{
					id: "019bef5a-93e4-7746-ad39-961afccc2508",
					hidden: false,
					title: "CET-6",
					issuer: "全国大学英语四、六级考试委员会",
					date: "2016",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "<p>604 分。</p>",
				},
			],
		},
		publications: {
			...sectionDefaults("books"),
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-9816f0081895",
					hidden: false,
					title: "高并发订单系统的幂等设计",
					publisher: "技术博客与团队内部分享",
					date: "2023",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "<p>总结订单链路中重复提交、超时重试与消息重投的幂等方案与取舍。</p>",
				},
			],
		},
		volunteer: {
			...sectionDefaults("hand-heart"),
			hidden: true,
			columns: 2,
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-a02580473e05",
					hidden: false,
					organization: "本地技术社区",
					location: "杭州",
					period: "2022 - 至今",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					description: "<p>每季度做一次分享，主题包括订单系统的演进与线上故障复盘。</p>",
				},
			],
		},
		references: {
			...sectionDefaults("phone"),
			hidden: true,
			items: [
				{
					id: "019bef5a-93e4-7746-ad39-a945c0f42dd5",
					hidden: false,
					name: "可提供",
					position: "",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					phone: "",
					description: "",
				},
			],
		},
	},
	customSections: [
		{
			...sectionDefaults("briefcase"),
			title: "实习经历",
			id: "019becaf-0b87-769d-98a6-46ccf558c0e8",
			type: "experience",
			items: [
				{
					id: "019bef5a-d1fa-7289-a87c-2677688d9e75",
					hidden: false,
					company: "某银行科技部",
					position: "后端开发实习生",
					location: "杭州",
					period: "2017.07 - 2017.12",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description:
						"<ul><li>参与对公账户查询接口的性能优化，把批量查询从 8 秒降到 1.2 秒</li><li>补齐接口文档与压测脚本，交付给测试团队复用</li></ul>",
				},
				{
					id: "019bef5a-db0e-73c6-9b6e-4471703864f1",
					hidden: false,
					company: "某创业公司",
					position: "后端开发实习生",
					location: "杭州",
					period: "2016.07 - 2016.09",
					website: {
						url: "",
						label: "",
						inlineLink: false,
					},
					roles: [],
					description: "<ul><li>用 Python 写数据采集与清洗脚本，支撑运营的日报看板</li></ul>",
				},
			],
		},
	],
	metadata: {
		template: "azurill",
		layout: {
			sidebarWidth: 30,
			pages: [
				{
					fullWidth: false,
					main: ["summary", "education", "experience"],
					sidebar: ["profiles", "skills"],
				},
				{
					fullWidth: false,
					main: ["019becaf-0b87-769d-98a6-46ccf558c0e8", "awards"],
					sidebar: ["certifications", "languages", "interests", "references"],
				},
				{
					fullWidth: true,
					main: ["projects", "publications", "volunteer"],
					sidebar: [],
				},
			],
		},
		page: {
			gapX: 12,
			gapY: 8,
			marginX: 16,
			marginY: 16,
			format: "a4",
			locale: "zh-CN",
			hideLinkUnderline: false,
			hideIcons: false,
			hideSectionIcons: false,
		},
		design: {
			level: {
				icon: "star",
				type: "icon",
			},
			colors: {
				primary: "rgba(0, 112, 178, 1)",
				text: "rgba(0, 0, 0, 1)",
				background: "rgba(255, 255, 255, 1)",
			},
		},
		typography: {
			body: {
				fontFamily: "Noto Serif SC",
				fontWeights: ["400", "700"],
				fontSize: 10,
				lineHeight: 1.5,
			},
			heading: {
				fontFamily: "Fira Sans Condensed",
				fontWeights: ["500"],
				fontSize: 12,
				lineHeight: 1.5,
			},
		},
		notes: "",
		styleRules: [],
	},
};

/**
 * Returns the sample resume, optionally overriding `basics.name` so the seeded
 * content reflects the name the user entered when creating the resume. When no
 * name is given, the default sample persona is returned unchanged.
 */
export const createSampleResumeData = (name?: string): ResumeData => {
	const trimmed = name?.trim();
	if (!trimmed) return sampleResumeData;

	return { ...sampleResumeData, basics: { ...sampleResumeData.basics, name: trimmed } };
};
