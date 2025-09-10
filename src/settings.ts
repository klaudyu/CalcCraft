import { PluginSettingTab, Setting } from "obsidian";
import { buyMeACoffee, paypal, revolut } from "./support";

export const DefaultSettings = {
	precision: "-1",
	showLabels: true,
	formula_background_color_toggle: true,
	showBorders: true,
	formula_background_error_toggle: true,
	formula_background_parents_toggle: true,
	formula_background_children_toggle: true,
	formula_background_matrix_toggle: true,
	formula_background_color_light: "#e0f2ff",
	formula_font_color_light: "#008bc7",
	formula_background_matrix_light: "#edf3f8",
	formula_font_matrix_light: "#3f74ab",
	formula_background_error_light: "#ff7aaf",
	formula_font_error_light: "#feffc7",
	formula_background_parents_light: "#157ca8",
	formula_font_parents_light: "#e3f2fe",
	formula_background_children_light: "#80f9c5",
	formula_font_children_light: "#004480",
	formula_background_color_dark: "#393347",
	formula_font_color_dark: "#fffafa",
	formula_background_matrix_dark: "#393346",
	formula_font_matrix_dark: "#ffffff",
	formula_background_error_dark: "#5c0000",
	formula_font_error_dark: "#eca7a7",
	formula_background_parents_dark: "#1f5656",
	formula_font_parents_dark: "#dff5fb",
	formula_background_children_dark: "#5c5275",
	formula_font_children_dark: "#dcffa8"
};

export class CalcCraftSettingsTab extends PluginSettingTab {
	plugin: any;

	constructor(app: any, plugin: any) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("how many decimals")
			.setDesc("use `-1` for default")
			.addText(text =>
				text
					.setPlaceholder("-1")
					.setValue(this.plugin.settings.precision)
					.onChange(async value => {
						this.plugin.settings.precision = value;
						await this.plugin.saveSettings();
						this.reloadPages();
					})
			);
		new Setting(containerEl)
			.setName("show labels")
			.setDesc("show labels.")
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showLabels).onChange(async value => {
					this.plugin.settings.showLabels = value;
					await this.plugin.saveSettings();
					this.reloadPages();
				})
			);
		new Setting(containerEl)
			.setName("show formula cell borders")
			.setDesc("show borders.")
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showBorders).onChange(async value => {
					this.plugin.settings.showBorders = value;
					await this.plugin.saveSettings();
					this.reloadPages();
					//this.plugin.updatecssvars();
				})
			);

		const themes = ["light", "dark"];

		themes.forEach(theme => {
			this.containerEl.createEl("h5", {
				text: `${theme} theme colors`
			});

			this.createColorpicker_fg_bg(
				containerEl,
				"formula's cells color",
				"always shown",
				`formula_font_color_${theme}`,
				`formula_background_color_${theme}`
			);
			this.createColorpicker_fg_bg(
				containerEl,
				"error cell color",
				"if cell is not computable",
				`formula_font_error_${theme}`,
				`formula_background_error_${theme}`
			);

			this.createColorpicker_fg_bg(
				containerEl,
				"parents cell color",
				"When you hover over a cell, highlight the cells upon which this cell depends.",
				`formula_font_parents_${theme}`,
				`formula_background_parents_${theme}`
			);

			this.createColorpicker_fg_bg(
				containerEl,
				"children cell color",
				"When you hover over a cell, highlight the cells that depend on this cell.",
				`formula_font_children_${theme}`,
				`formula_background_children_${theme}`
			);

			this.createColorpicker_fg_bg(
				containerEl,
				"matrix cell color",
				"[light theme]",
				`formula_font_matrix_${theme}`,
				`formula_background_matrix_${theme}`
			);
		});

		const div = containerEl.createEl("div", {
			cls: "advanced-tables-donation"
		});

		const donateText = document.createElement("p");
		donateText.appendText(
			"If this plugin adds value for you and you would like to help support " +
				"continued development, please use the buttons below:"
		);
		div.appendChild(donateText);

		const parser = new DOMParser();

		div.appendChild(
			createDonateButton(
				"https://www.paypal.com/paypalme/klaudyu",
				parser.parseFromString(paypal, "text/xml").documentElement
			)
		);

		div.appendChild(
			createDonateButton(
				"https://www.buymeacoffee.com/klaudyul",
				parser.parseFromString(buyMeACoffee, "text/xml").documentElement
			)
		);

		div.appendChild(
			createDonateButton(
				"https://revolut.me/klaudyu",
				parser.parseFromString(revolut, "text/xml").documentElement
			)
		);
	}

	reloadPages() {
		this.app.workspace.getLeavesOfType("markdown").forEach((e: any) => e.rebuildView());
	}

	createColorpicker_fg_bg(containerEl: any, name: string, description: string, colorfg: string, colorbg: string) {
		const sett = new Setting(containerEl).setName(name).setDesc(description);
		const togglename =
			colorbg.substring(
				0,
				colorbg.lastIndexOf("_") === -1 ? colorbg.length : colorbg.lastIndexOf("_")
			) + "_toggle";

		sett.addToggle(toggle =>
			toggle.setValue(this.plugin.settings[togglename]).onChange(async value => {
				this.plugin.settings[togglename] = value;
				await this.plugin.saveSettings();
				this.display();
				this.reloadPages();
			})
		);

		if (this.plugin.settings[togglename]) {
			this.createColorPicker(sett, "font color:", colorfg);
			this.createColorPicker(sett, "background color:", colorbg);
		}
	}
	createColorPicker(setting: any, text: string, variable: string) {
		this.plugin.cssVariables.push(variable);
		const color_picker = createEl(
			"input",
			{
				type: "color",
				cls: "settings-color-picker"
			},
			el => {
				el.value = this.plugin.settings[variable];
				el.onchange = () => {
					this.plugin.settings[variable] = el.value;
					this.plugin.saveSettings();
					//this.plugin.updatecssvars();
					document.documentElement.style.setProperty(
						"--CalcCraft_" + variable,
						this.plugin.settings[variable]
					);
				};
			}
		);
		setting.controlEl.appendChild(createEl("span", { text: text }));
		setting.controlEl.appendChild(color_picker);
	}
}

const createDonateButton = (link: string, img: HTMLElement): HTMLElement => {
	const a = document.createElement("a");
	a.setAttribute("href", link);
	a.addClass("advanced-tables-donate-button");
	a.appendChild(img);
	return a;
};