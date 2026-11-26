## Upgrading Biogas CO2 to Green Methanol via Wind & Solar-Powered Alkaline Electrolysis - Power to X -

## Authors

- **Aung Kyawo** 
- **Veloy Fernandes** 
- **Denizhan Arslanbeka** 

## Description

This Python script simulates the energy output of a co-located solar and wind farm and performs a comprehensive energy balance analysis for a green methanol production facility. The project models a power-to-X system that converts biogas CO2 to green methanol using renewable energy from wind and solar sources powering an alkaline electrolysis system.

The simulation provides detailed analysis of:
- Solar photovoltaic farm energy generation using clear-sky modeling
- Wind farm energy generation using NASA POWER meteorological data
- Energy balance calculations for electrolyzer and methanol plant operations
- Grid interaction analysis (energy excess/deficit scenarios)
- Comprehensive data visualization and statistical analysis

## How It Works (Step-by-Step Explanation)

### 1. Initial Setup
The notebook begins by importing essential Python libraries and defining user-configurable parameters for both solar and wind farm simulations:

- **Libraries**: pvlib for solar modeling, windpowerlib for wind modeling, pandas for data manipulation, matplotlib for visualization, 
umpy for numerical computations
- **Solar Parameters**: Farm capacity (304 MW DC), location coordinates (Aabenraa, Denmark), panel specifications, tilt and azimuth angles
- **Wind Parameters**: Turbine specifications (V90/3000), number of turbines (20), spacing factors, target hub height (130m)
- **Location**: Latitude 55.03N, Longitude 9.28E (Aabenraa Kasso, Denmark)

### 2. Solar Farm Simulation
The solar simulation uses the pvlib library to model a large-scale photovoltaic installation:

- **Component Retrieval**: Fetches module and inverter specifications from the System Advisor Model (SAM) database
- **System Configuration**: Calculates optimal system sizing based on target DC capacity and component specifications
- **Modeling**: Uses PVSystem and ModelChain classes to simulate system performance
- **Weather Data**: Employs a clear-sky solar irradiance model for baseline energy estimates
- **Output Calculation**: Generates hourly AC power output scaled to the entire farm capacity

The simulation accounts for:
- Temperature effects on module performance
- Inverter efficiency and clipping
- System voltage constraints
- DC/AC power ratio optimization

### 3. Wind Farm Simulation
The wind simulation leverages the windpowerlib library and real meteorological data:

- **Data Acquisition**: Retrieves hourly weather data from NASA POWER API including wind speed, direction, temperature, and pressure
- **Data Processing**: Extrapolates wind conditions to turbine hub height using logarithmic wind profile models
- **Turbine Layout**: Defines circular turbine arrangement with specified spacing factors
- **Wake Effects**: Applies Jensen wake loss model to account for turbine interactions
- **Power Calculation**: Generates hourly power output considering air density corrections and power curve smoothing

The simulation includes:
- Multi-height wind speed extrapolation
- Temperature and pressure corrections
- Wake loss modeling between turbines
- Power curve interpolation and smoothing

### 4. Combined Energy Table
The script merges solar and wind energy data into a unified time-series dataset:

- **Temporal Alignment**: Synchronizes both energy sources to a common hourly timestamp
- **Timezone Handling**: Ensures consistent timezone representation (Europe/Copenhagen)
- **Data Integration**: Creates a comprehensive table with separate columns for solar and wind energy yields
- **Quality Control**: Handles missing data points and ensures data continuity

### 5. Energy Balance Analysis
Performs detailed energy balance calculations considering system consumption requirements:

- **Consumption Modeling**: Defines constant power demands for electrolyzer (53 MW) and methanol plant (2 MW)
- **Uptime Factors**: Applies operational efficiency factors (92% uptime)
- **Balance Calculation**: Computes hourly net energy (generation minus consumption)
- **Grid Interaction**: Determines excess/deficit scenarios for each time period
- **Aggregation**: Provides daily, weekly, and monthly energy summaries

The analysis includes:
- Hourly energy generation and consumption tracking
- Net energy balance calculations
- Grid interaction status determination
- Monthly and seasonal trend analysis

### 6. Data Visualization
Generates comprehensive plots and visualizations:

- **Solar Analysis**: Clear-sky irradiance patterns, farm power output time series
- **Wind Analysis**: Power curves, time series output, daily/weekly/monthly summaries
- **Statistical Plots**: Weibull wind speed distributions, wind rose diagrams
- **Energy Balance**: Generation vs consumption comparison, net energy visualization
- **Seasonal Trends**: Monthly power output variations for both sources

## Installation and Usage

1. **Install Required Packages**:
   `ash
   pip install -r requirements.txt
   `

2. **Run the Notebook**:
   - Open Wind_Solar_v24.ipynb in Jupyter Notebook or JupyterLab
   - Execute cells sequentially from top to bottom
   - Modify parameters in the initial setup section as needed

3. **Key Parameters to Configure**:
   - SOLAR_FARM_TARGET_DC_CAPACITY_MW: Target solar farm capacity
   - WIND_NUM_TURBINES: Number of wind turbines
   - Location coordinates for your specific site
   - Consumption parameters for your electrolysis system

## Interactive Website

An interactive web UI for the project lives in the `docs/` folder and is published at:

**https://veloyfernandes.github.io/green-methanol/**

It includes:
- **Overview and process flow** – headline results and live mass flows (H2, CO2, methanol, water, oxygen)
- **Energy balance and scenario simulator** – resize the solar farm, wind farm, electrolyzer and methanol plant, switch between clear-sky and all-sky solar, and see the hourly, daily, weekly and monthly balance, grid import/export and the monthly table update instantly (with CSV download)
- **Solar and wind pages** – system design, irradiance, tilt/azimuth sensitivity, power curve, Weibull distribution, wind rose and seasonal complementarity
- **Site comparison** – map and ranking of 31 Danish locations
- **Economics** – editable levelised cost of methanol with Monte Carlo and tornado sensitivity analysis

The site is fully static. To preview it locally, open `docs/index.html` in a browser.

**Regenerating the data** (re-runs the notebook's models and writes `docs/assets/data.js`):
```bash
pip install -r requirements.txt
python scripts/build_site_data.py
```

**Tests** (calculation checks against the notebook's printed results, and a browser test that needs Playwright):
```bash
node --test tests/model.test.js
node tests/e2e.js
```

## Results

The simulation provides:
- **Solar Energy Yield**: Estimated annual generation based on clear-sky model
- **Wind Energy Yield**: Estimated annual generation based on historical weather patterns
- **Energy Balance**: Hourly/monthly surplus or deficit analysis
- **Grid Interaction**: Periods requiring grid import/export
- **System Optimization**: Insights for renewable energy system sizing

## Citations and Sources

### Key Python Libraries
- **pvlib**: Holmgren, W. F., Hansen, C. W., & Mikofski, M. A. (2018). pvlib python: a python package for modeling solar energy systems. *Journal of Open Source Software*, 3(29), 884.
- **windpowerlib**: Krien, U., Lenck, T., Schönfeldt, P., & Reinert, S. (2019). windpowerlib: a python library for wind power modelling. *Journal of Open Source Software*, 4(36), 1157.
- **pandas**: McKinney, W. (2010). Data structures for statistical computing in python. *Proceedings of the 9th Python in Science Conference*, 445, 51-56.
- **matplotlib**: Hunter, J. D. (2007). Matplotlib: A 2D graphics environment. *Computing in Science & Engineering*, 9(3), 90-95.

### Weather Data Source
- **NASA POWER**: NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program. Data accessed via the POWER API at https://power.larc.nasa.gov/

### Equipment Databases
- **System Advisor Model (SAM)**: National Renewable Energy Laboratory component databases for photovoltaic modules and inverters

## Future Improvements

- **Weather Data Enhancement**: Integrate actual measured weather data instead of clear-sky models for more accurate solar predictions
- **Economic Analysis**: Add comprehensive cost analysis including CAPEX, OPEX, and LCOE calculations
- **Energy Storage Integration**: Develop sophisticated battery storage and energy management models
- **Grid Integration**: Model grid stability impacts and power quality considerations  
- **Interactive Dashboard**: Create web-based dashboard for real-time results visualization and scenario analysis
- **Optimization Algorithms**: Implement automated system sizing and configuration optimization
- **Seasonal Storage**: Model long-term energy storage solutions for seasonal variations
- **Carbon Footprint Analysis**: Add lifecycle carbon assessment for the complete power-to-X system

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

This work was developed as part of research into sustainable energy systems and power-to-X technologies for green fuel production. Special thanks to the developers of the open-source libraries that made this analysis possible.
=======
# Upgrading-Biogas-CO2-to-Green-Methanol-via-Wind-Solar-Powered-Alkaline-Electrolysis
This Python script simulates a hybrid solar and wind farm using pvlib and windpowerlib. It fetches NASA POWER API data to model combined energy output. The code then analyzes the energy balance against an electrolyzer and methanol plant's consumption, calculating the net grid surplus or deficit and visualizing the results.
