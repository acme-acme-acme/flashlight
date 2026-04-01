import * as React from "react";
import { styled, alpha } from "@mui/material/styles";
import InputBase from "@mui/material/InputBase";
import { AndroidRounded, Apple } from "@mui/icons-material";
import { DetectedPlatform } from "../../server/socket/socketInterface";

const Search = styled("div")(({ theme }) => ({
  position: "relative",
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  "&:hover": {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginLeft: 0,
  width: 300,
}));

const SearchIconWrapper = styled("div")(() => ({
  paddingLeft: 10,
  paddingRight: 10,
  height: "100%",
  position: "absolute",
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: "inherit",
  "& .MuiInputBase-input": {
    padding: 10,
    // vertical padding + font size from searchIcon
    paddingLeft: 45,
    transition: theme.transitions.create("width"),
    width: 300 - 45 - 10,
  },
}));

const PlatformIcon = ({ platform }: { platform: DetectedPlatform }) => {
  if (platform === "ios") {
    return <Apple />;
  }
  return <AndroidRounded />;
};

export const TextField = ({
  onChange,
  value,
  platform,
}: {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  value: string;
  platform: DetectedPlatform;
}) => {
  return (
    <Search>
      <SearchIconWrapper>
        <PlatformIcon platform={platform} />
      </SearchIconWrapper>
      <StyledInputBase placeholder="Fill in your app id" onChange={onChange} value={value} />
    </Search>
  );
};
